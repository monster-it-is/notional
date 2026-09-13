import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  db,
  ensurePaperAccount,
  paperAccount,
  user,
} from "./index.js";
import { endTestPool, resetTestTables } from "./test.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ZERO_DECIMAL = /^0(?:\.0+)?$/;

describe("paper_account", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("creates a paper account for an existing user", async () => {
    const createdUser = await insertUser("ada@example.com");

    const account = await ensurePaperAccount(db, createdUser.id);

    expect(account.id).toMatch(UUID_PATTERN);
    expect(account.userId).toBe(createdUser.id);
    expect(account.currency).toBe("USDT");
    expect(account.status).toBe("ACTIVE");
    expect(account.lastFaucetClaimAt).toBeNull();
    expect(typeof account.balance).toBe("string");
    expect(account.balance).toMatch(ZERO_DECIMAL);
  });

  it("returns the same account when ensure is repeated", async () => {
    const createdUser = await insertUser("ada@example.com");

    const first = await ensurePaperAccount(db, createdUser.id);
    const second = await ensurePaperAccount(db, createdUser.id);

    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(paperAccount)
      .where(eq(paperAccount.userId, createdUser.id));

    expect(rows).toHaveLength(1);
  });

  it("creates exactly one row under concurrent ensure calls", async () => {
    const createdUser = await insertUser("ada@example.com");

    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensurePaperAccount(db, createdUser.id)),
    );

    const ids = new Set(results.map((account) => account.id));
    expect(ids.size).toBe(1);

    const rows = await db
      .select()
      .from(paperAccount)
      .where(eq(paperAccount.userId, createdUser.id));

    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.balance).toBe("string");
    expect(rows[0]?.balance).toMatch(ZERO_DECIMAL);
  });

  it("defaults balance to zero as a string", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);

    expect(typeof account.balance).toBe("string");
    expect(account.balance).toMatch(ZERO_DECIMAL);
    expect(account.balance).not.toBe("1000");
  });

  it("rejects a negative balance at the database", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);

    await expectRejectedConstraint(
      db
        .update(paperAccount)
        .set({ balance: "-1" })
        .where(eq(paperAccount.id, account.id)),
      "paper_account_balance_non_negative",
    );
  });

  it("rejects a non-USDT currency at the database", async () => {
    const createdUser = await insertUser("ada@example.com");

    await expectRejectedConstraint(
      db.insert(paperAccount).values({
        userId: createdUser.id,
        currency: "USD",
      }),
      "paper_account_currency_usdt",
    );
  });

  it("rejects an invalid status at the database", async () => {
    const createdUser = await insertUser("ada@example.com");

    await expectRejectedConstraint(
      db.insert(paperAccount).values({
        userId: createdUser.id,
        status: "CLOSED",
      }),
      "paper_account_status_valid",
    );
  });

  it("rejects a paper account for a nonexistent user", async () => {
    await expectRejectedConstraint(
      db.insert(paperAccount).values({
        userId: "00000000-0000-4000-8000-000000000001",
      }),
      "paper_account_user_id_user_id_fk",
    );
  });
});

async function expectRejectedConstraint(
  operation: Promise<unknown>,
  constraint: string,
): Promise<void> {
  await expect(operation).rejects.toSatisfy((error: unknown) => {
    return postgresConstraint(error) === constraint;
  });
}

function postgresConstraint(error: unknown): string | undefined {
  let current: unknown = error;

  while (current && typeof current === "object") {
    if ("constraint" in current && typeof current.constraint === "string") {
      return current.constraint;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return undefined;
}

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
