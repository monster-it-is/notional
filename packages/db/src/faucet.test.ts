import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  applyFaucetClaim,
  db,
  ensurePaperAccount,
  ensureSystemVirtualFundingAccount,
  ensureUserCashLedgerAccount,
  fromDbDecimal,
  insertFundingEvent,
  listFundingEventsByPaperAccountId,
  MoneyDecimal,
  postLedgerTransaction,
  readFaucetCooldownState,
  SIGNUP_ALLOCATION_AMOUNT,
  user,
} from "./index.js";
import {
  endTestPool,
  resetTestTables,
  setLastFaucetClaimAtUtc,
  setLastFaucetClaimBefore24h,
  setLastFaucetClaimElapsed24h,
} from "./test.js";

describe("faucet cooldown and funding history primitives", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("treats a 24-hour SQL boundary as eligible and one second before as ineligible", async () => {
    const result = await db.execute(sql`
      SELECT
        (TIMESTAMP '2026-01-02 00:00:00' >= TIMESTAMP '2026-01-01 00:00:00' + INTERVAL '24 hours')
          AS exact_boundary,
        (TIMESTAMP '2026-01-01 23:59:59' >= TIMESTAMP '2026-01-01 00:00:00' + INTERVAL '24 hours')
          AS before_boundary,
        to_char(
          (TIMESTAMP '2026-01-01 00:00:00' + INTERVAL '24 hours') AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS next_claim_at
    `);
    const row = result.rows[0] as {
      exact_boundary: boolean;
      before_boundary: boolean;
      next_claim_at: string;
    };

    expect(row.exact_boundary).toBe(true);
    expect(row.before_boundary).toBe(false);
    expect(row.next_claim_at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("returns nextClaimAt as an absolute UTC instant for a known naive timestamp", async () => {
    const createdUser = await insertUser("faucet-utc@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);

    await setLastFaucetClaimAtUtc(account.id, "2099-06-15 10:30:00");

    const cooldown = await db.transaction((tx) =>
      readFaucetCooldownState(tx, account.id),
    );

    expect(cooldown.eligible).toBe(false);
    expect(cooldown.nextClaimAt?.toISOString()).toBe("2099-06-16T10:30:00.000Z");
    expect(cooldown.claimedAtUtc).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/,
    );
  });

  it("evaluates cooldown from UTC-naive clock_timestamp after the paper account exists", async () => {
    const createdUser = await insertUser("faucet-clock@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);

    const first = await db.transaction((tx) =>
      readFaucetCooldownState(tx, account.id),
    );

    expect(first.eligible).toBe(true);
    expect(first.nextClaimAt).toBeNull();
    expect(first.claimedAtUtc).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/,
    );

    await setLastFaucetClaimBefore24h(account.id);

    const cooling = await db.transaction((tx) =>
      readFaucetCooldownState(tx, account.id),
    );

    expect(cooling.eligible).toBe(false);
    expect(cooling.nextClaimAt).toBeInstanceOf(Date);
    expect(cooling.nextClaimAt?.toISOString()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );

    await setLastFaucetClaimElapsed24h(account.id);

    const elapsed = await db.transaction((tx) =>
      readFaucetCooldownState(tx, account.id),
    );

    expect(elapsed.eligible).toBe(true);
  });

  it("persists the sampled UTC-naive claim instant without a JS Date round-trip", async () => {
    const createdUser = await insertUser("faucet-persist@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);

    await db.transaction(async (tx) => {
      const cooldown = await readFaucetCooldownState(tx, account.id);
      expect(cooldown.eligible).toBe(true);

      await applyFaucetClaim(tx, {
        paperAccountId: account.id,
        balance: fromDbDecimal(account.balance),
        claimedAtUtc: cooldown.claimedAtUtc,
      });

      const result = await tx.execute(sql`
        SELECT last_faucet_claim_at = ${cooldown.claimedAtUtc}::timestamp AS same_instant
        FROM paper_account
        WHERE id = ${account.id}
      `);
      const [same] = result.rows as Array<{ same_instant: boolean }>;

      expect(same?.same_instant).toBe(true);
      expect(cooldown.claimedAtUtc).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/,
      );
    });
  });

  it("lists funding events newest first with pagination", async () => {
    const createdUser = await insertUser("funding-list@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const systemFunding = await ensureSystemVirtualFundingAccount(db);
    const faucetAmount = new MoneyDecimal("100");

    await db.transaction(async (tx) => {
      const signup = await postLedgerTransaction(tx, {
        eventType: "SIGNUP_ALLOCATION",
        idempotencyKey: "signup-allocation:list",
        entries: [
          { ledgerAccountId: userCash.id, amount: SIGNUP_ALLOCATION_AMOUNT },
          {
            ledgerAccountId: systemFunding.id,
            amount: SIGNUP_ALLOCATION_AMOUNT.negated(),
          },
        ],
      });
      await insertFundingEvent(tx, {
        paperAccountId: account.id,
        eventType: "SIGNUP_ALLOCATION",
        amount: SIGNUP_ALLOCATION_AMOUNT,
        idempotencyKey: "signup-allocation:list",
        ledgerTransactionId: signup.id,
      });
    });

    await db.transaction(async (tx) => {
      const faucet = await postLedgerTransaction(tx, {
        eventType: "FAUCET_CLAIM",
        idempotencyKey: "faucet:list",
        entries: [
          { ledgerAccountId: userCash.id, amount: faucetAmount },
          {
            ledgerAccountId: systemFunding.id,
            amount: faucetAmount.negated(),
          },
        ],
      });
      await insertFundingEvent(tx, {
        paperAccountId: account.id,
        eventType: "FAUCET_CLAIM",
        amount: faucetAmount,
        idempotencyKey: "faucet:list",
        ledgerTransactionId: faucet.id,
      });
    });

    const newest = await listFundingEventsByPaperAccountId(db, account.id, {
      limit: 1,
      offset: 0,
    });
    const older = await listFundingEventsByPaperAccountId(db, account.id, {
      limit: 1,
      offset: 1,
    });

    expect(newest).toHaveLength(1);
    expect(newest[0]?.eventType).toBe("FAUCET_CLAIM");
    expect(older).toHaveLength(1);
    expect(older[0]?.eventType).toBe("SIGNUP_ALLOCATION");
  });
});

async function insertUser(email: string) {
  const [created] = await db
    .insert(user)
    .values({
      name: "Ada Lovelace",
      email,
    })
    .returning({ id: user.id });

  if (!created) {
    throw new Error("failed to insert user");
  }

  return created;
}
