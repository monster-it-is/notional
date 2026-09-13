import type {
  AccountNotInitializedError,
  AccountResponse,
  AccountSuspendedError,
  FaucetCooldownError,
  FundingHistoryResponse,
} from "@notional/contracts";
import {
  db,
  ensurePaperAccount,
  findPaperAccountByUserId,
  fromDbDecimal,
  fundingEvent,
  ledgerAccount,
  ledgerEntry,
  ledgerTransaction,
  paperAccount,
  SIGNUP_ALLOCATION_AMOUNT,
} from "@notional/db";
import {
  endTestPool,
  resetTestTables,
  setLastFaucetClaimAtUtc,
  setLastFaucetClaimBefore24h,
  setLastFaucetClaimElapsed24h,
  setPaperAccountStatusForTests,
} from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { env } from "./env.js";
import { claimFaucetInTx } from "./services/faucet.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const password = "correct-horse-battery";

describe("faucet api", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("returns 401 for unauthenticated faucet and funding routes", async () => {
    const faucet = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
    });
    const funding = await app.inject({
      method: "GET",
      url: "/api/account/funding",
    });

    expect(faucet.statusCode).toBe(401);
    expect(faucet.json()).toEqual({ error: "Unauthorized" });
    expect(funding.statusCode).toBe(401);
    expect(funding.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects an uninitialized account", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "uninitialized-faucet@example.com",
      password,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "ACCOUNT_NOT_INITIALIZED",
    } satisfies AccountNotInitializedError);
    expect(await db.select().from(fundingEvent)).toHaveLength(0);
    expect(await db.select().from(ledgerTransaction)).toHaveLength(0);
  });

  it("rejects a Phase 3 zero-balance paper account without signup allocation", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "phase3-faucet@example.com",
      password,
    });
    const signupBody = signup.json() as { user: { id: string } };
    await ensurePaperAccount(db, signupBody.user.id);

    const response = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "ACCOUNT_NOT_INITIALIZED",
    } satisfies AccountNotInitializedError);
    expect(await db.select().from(fundingEvent)).toHaveLength(0);
  });

  it("credits the configured faucet amount exactly once on a successful claim", async () => {
    const { cookies, accountId } = await initializeUser(
      app,
      "faucet-success@example.com",
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as AccountResponse;
    const expectedBalance = SIGNUP_ALLOCATION_AMOUNT.plus(env.FAUCET_AMOUNT);

    expect(body.id).toBe(accountId);
    expect(typeof body.balance).toBe("string");
    expect(fromDbDecimal(body.balance).eq(expectedBalance)).toBe(true);
    expect(body.lastFaucetClaimAt).toMatch(ISO_PATTERN);

    const read = await app.inject({
      method: "GET",
      url: "/api/account",
      headers: authHeadersFromCookie(cookies),
    });
    expect(read.statusCode).toBe(200);
    const readBody = read.json() as AccountResponse;
    expect(fromDbDecimal(readBody.balance).eq(expectedBalance)).toBe(true);
    expect(readBody.lastFaucetClaimAt).toBe(body.lastFaucetClaimAt);

    await assertSingleFaucetClaim(accountId, expectedBalance);
  });

  it("rejects an immediate second claim and leaves financial history unchanged", async () => {
    const { cookies, accountId, userId } = await initializeUser(
      app,
      "faucet-cooldown@example.com",
    );

    const first = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeadersFromCookie(cookies),
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as AccountResponse;

    const second = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeadersFromCookie(cookies),
    });

    expect(second.statusCode).toBe(409);
    const cooldown = second.json() as FaucetCooldownError;
    expect(cooldown.error).toBe("FAUCET_COOLDOWN");
    expect(cooldown.nextClaimAt).toMatch(ISO_PATTERN);
    expect(cooldown.nextClaimAt.endsWith("Z")).toBe(true);
    expect(new Date(cooldown.nextClaimAt).toISOString()).toBe(cooldown.nextClaimAt);

    const afterCooldown = await findPaperAccountByUserId(db, userId);
    expect(
      fromDbDecimal(afterCooldown!.balance).eq(fromDbDecimal(firstBody.balance)),
    ).toBe(true);
    expect(afterCooldown!.lastFaucetClaimAt?.toISOString()).toBe(
      firstBody.lastFaucetClaimAt,
    );

    await assertSingleFaucetClaim(
      accountId,
      SIGNUP_ALLOCATION_AMOUNT.plus(env.FAUCET_AMOUNT),
    );
  });

  it("allows a claim at the 24-hour boundary and rejects one just before it", async () => {
    const { cookies, accountId } = await initializeUser(
      app,
      "faucet-boundary@example.com",
    );

    const seeded = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeadersFromCookie(cookies),
    });
    expect(seeded.statusCode).toBe(200);

    await setLastFaucetClaimBefore24h(accountId);

    const tooSoon = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeadersFromCookie(cookies),
    });
    expect(tooSoon.statusCode).toBe(409);
    expect(tooSoon.json()).toMatchObject({ error: "FAUCET_COOLDOWN" });
    await assertSingleFaucetClaim(
      accountId,
      SIGNUP_ALLOCATION_AMOUNT.plus(env.FAUCET_AMOUNT),
    );

    await setLastFaucetClaimElapsed24h(accountId);

    const eligible = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeadersFromCookie(cookies),
    });
    expect(eligible.statusCode).toBe(200);
    const eligibleBody = eligible.json() as AccountResponse;
    expect(
      fromDbDecimal(eligibleBody.balance).eq(
        SIGNUP_ALLOCATION_AMOUNT.plus(env.FAUCET_AMOUNT).plus(env.FAUCET_AMOUNT),
      ),
    ).toBe(true);

    const faucetEvents = (await db.select().from(fundingEvent)).filter(
      (event) => event.eventType === "FAUCET_CLAIM",
    );
    expect(faucetEvents).toHaveLength(2);
  });

  it("creates exactly one faucet claim under concurrent requests", async () => {
    const { cookies, accountId } = await initializeUser(
      app,
      "faucet-concurrent@example.com",
    );

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: "POST",
          url: "/api/account/faucet",
          headers: authHeadersFromCookie(cookies),
        }),
      ),
    );

    const successes = responses.filter((response) => response.statusCode === 200);
    const cooldowns = responses.filter((response) => response.statusCode === 409);

    expect(successes).toHaveLength(1);
    expect(cooldowns).toHaveLength(7);

    for (const cooldown of cooldowns) {
      expect(cooldown.json()).toMatchObject({ error: "FAUCET_COOLDOWN" });
    }

    const successBody = successes[0]!.json() as AccountResponse;
    expect(
      fromDbDecimal(successBody.balance).eq(
        SIGNUP_ALLOCATION_AMOUNT.plus(env.FAUCET_AMOUNT),
      ),
    ).toBe(true);

    await assertSingleFaucetClaim(
      accountId,
      SIGNUP_ALLOCATION_AMOUNT.plus(env.FAUCET_AMOUNT),
    );
  });

  it("rolls back faucet financial effects when the surrounding transaction throws", async () => {
    const { userId, accountId } = await initializeUser(
      app,
      "faucet-rollback@example.com",
    );
    const before = await findPaperAccountByUserId(db, userId);

    await expect(
      db.transaction(async (tx) => {
        await claimFaucetInTx(tx, userId);
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    const after = await findPaperAccountByUserId(db, userId);
    expect(fromDbDecimal(after!.balance).eq(fromDbDecimal(before!.balance))).toBe(
      true,
    );
    expect(after!.lastFaucetClaimAt).toBeNull();

    const faucetEvents = (await db.select().from(fundingEvent)).filter(
      (event) => event.eventType === "FAUCET_CLAIM",
    );
    const faucetTxns = (await db.select().from(ledgerTransaction)).filter(
      (transaction) => transaction.eventType === "FAUCET_CLAIM",
    );

    expect(faucetEvents).toHaveLength(0);
    expect(faucetTxns).toHaveLength(0);
    expect(after!.id).toBe(accountId);
  });

  it("rejects a suspended account", async () => {
    const { cookies, accountId } = await initializeUser(
      app,
      "faucet-suspended@example.com",
    );

    await setPaperAccountStatusForTests(accountId, "SUSPENDED");

    const response = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "ACCOUNT_SUSPENDED",
    } satisfies AccountSuspendedError);

    expect(
      (await db.select().from(fundingEvent)).filter(
        (event) => event.eventType === "FAUCET_CLAIM",
      ),
    ).toHaveLength(0);
  });

  it("returns funding history newest first without ledger internals", async () => {
    const { cookies } = await initializeUser(
      app,
      "funding-history@example.com",
    );

    const claimed = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeadersFromCookie(cookies),
    });
    expect(claimed.statusCode).toBe(200);

    const history = await app.inject({
      method: "GET",
      url: "/api/account/funding",
      headers: authHeadersFromCookie(cookies),
    });
    expect(history.statusCode).toBe(200);

    const body = history.json() as FundingHistoryResponse;
    expect(body.events).toHaveLength(2);
    expect(body.events[0]?.type).toBe("FAUCET_CLAIM");
    expect(body.events[1]?.type).toBe("SIGNUP_ALLOCATION");
    expect(typeof body.events[0]?.amount).toBe("string");
    expect(fromDbDecimal(body.events[0]!.amount).eq(env.FAUCET_AMOUNT)).toBe(true);
    expect(fromDbDecimal(body.events[1]!.amount).eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(
      true,
    );
    expect(body.events[0]?.createdAt).toMatch(ISO_PATTERN);
    expect(body.events[0]?.id).toMatch(UUID_PATTERN);
    expect(JSON.stringify(body)).not.toContain("ledgerTransactionId");
    expect(JSON.stringify(body)).not.toContain("idempotencyKey");
    expect(JSON.stringify(body)).not.toContain("paperAccountId");
    expect(body.events[0]).not.toHaveProperty("userId");

    const page = await app.inject({
      method: "GET",
      url: "/api/account/funding?limit=1&offset=1",
      headers: authHeadersFromCookie(cookies),
    });
    expect(page.statusCode).toBe(200);
    const pageBody = page.json() as FundingHistoryResponse;
    expect(pageBody.events).toHaveLength(1);
    expect(pageBody.events[0]?.type).toBe("SIGNUP_ALLOCATION");

    const invalid = await app.inject({
      method: "GET",
      url: "/api/account/funding?limit=101",
      headers: authHeadersFromCookie(cookies),
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "INVALID_PAGINATION" });

    const unsafe = await app.inject({
      method: "GET",
      url: "/api/account/funding?offset=99999999999999999999",
      headers: authHeadersFromCookie(cookies),
    });
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.json()).toEqual({ error: "INVALID_PAGINATION" });
  });

  it("returns a UTC nextClaimAt for a stored timezone-less claim timestamp", async () => {
    const { cookies, accountId } = await initializeUser(
      app,
      "faucet-utc-next@example.com",
    );

    await setLastFaucetClaimAtUtc(accountId, "2099-06-15 10:30:00");

    const response = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "FAUCET_COOLDOWN",
      nextClaimAt: "2099-06-16T10:30:00.000Z",
    } satisfies FaucetCooldownError);

    expect(
      (await db.select().from(fundingEvent)).filter(
        (event) => event.eventType === "FAUCET_CLAIM",
      ),
    ).toHaveLength(0);
  });

  it("does not expose funding history for an uninitialized account", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "funding-uninitialized@example.com",
      password,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/account/funding",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "ACCOUNT_NOT_INITIALIZED",
    } satisfies AccountNotInitializedError);
  });
});

async function assertSingleFaucetClaim(
  paperAccountId: string,
  expectedBalance: ReturnType<typeof SIGNUP_ALLOCATION_AMOUNT.plus>,
): Promise<void> {
  const account = (await db.select().from(paperAccount)).find(
    (row) => row.id === paperAccountId,
  );
  expect(account).toBeDefined();
  expect(typeof account!.balance).toBe("string");
  expect(fromDbDecimal(account!.balance).eq(expectedBalance)).toBe(true);
  expect(account!.lastFaucetClaimAt).toBeInstanceOf(Date);

  const faucetEvents = (await db.select().from(fundingEvent)).filter(
    (event) => event.eventType === "FAUCET_CLAIM",
  );
  expect(faucetEvents).toHaveLength(1);
  expect(typeof faucetEvents[0]?.amount).toBe("string");
  expect(fromDbDecimal(faucetEvents[0]!.amount).eq(env.FAUCET_AMOUNT)).toBe(true);

  const faucetTxns = (await db.select().from(ledgerTransaction)).filter(
    (transaction) => transaction.eventType === "FAUCET_CLAIM",
  );
  expect(faucetTxns).toHaveLength(1);
  expect(faucetTxns[0]?.id).toBe(faucetEvents[0]?.ledgerTransactionId);

  const entries = (await db.select().from(ledgerEntry)).filter(
    (entry) => entry.ledgerTransactionId === faucetTxns[0]!.id,
  );
  expect(entries).toHaveLength(2);

  const ledgerAccounts = await db.select().from(ledgerAccount);
  const userCash = ledgerAccounts.find((row) => row.kind === "USER_CASH");
  const systemFunding = ledgerAccounts.find(
    (row) => row.kind === "SYSTEM_VIRTUAL_FUNDING",
  );
  const userCashEntry = entries.find(
    (entry) => entry.ledgerAccountId === userCash?.id,
  );
  const systemEntry = entries.find(
    (entry) => entry.ledgerAccountId === systemFunding?.id,
  );

  expect(fromDbDecimal(userCashEntry!.amount).eq(env.FAUCET_AMOUNT)).toBe(true);
  expect(
    fromDbDecimal(systemEntry!.amount).eq(env.FAUCET_AMOUNT.negated()),
  ).toBe(true);
  expect(
    fromDbDecimal(userCashEntry!.amount).plus(fromDbDecimal(systemEntry!.amount)).isZero(),
  ).toBe(true);
}

async function initializeUser(app: FastifyInstance, email: string) {
  const signup = await signUp(app, {
    name: "Ada Lovelace",
    email,
    password,
  });
  const signupBody = signup.json() as { user: { id: string } };
  const cookies = cookieHeader(signup);

  const initialized = await app.inject({
    method: "POST",
    url: "/api/account/initialize",
    headers: authHeadersFromCookie(cookies),
  });
  expect(initialized.statusCode).toBe(200);
  const body = initialized.json() as AccountResponse;

  return {
    cookies,
    userId: signupBody.user.id,
    accountId: body.id,
  };
}

async function signUp(
  app: FastifyInstance,
  body: { name: string; email: string; password: string },
) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: {
      origin: process.env.WEB_ORIGIN,
    },
    payload: body,
  });
}

function authHeaders(response: {
  cookies: Array<{ name: string; value: string }>;
}) {
  return authHeadersFromCookie(cookieHeader(response));
}

function authHeadersFromCookie(cookie: string) {
  return {
    cookie,
    origin: process.env.WEB_ORIGIN,
  };
}

function cookieHeader(response: {
  cookies: Array<{ name: string; value: string }>;
}): string {
  return response.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}
