import type { AccountNotInitializedError, AccountResponse } from "@notional/contracts";
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
import { endTestPool, resetTestTables } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { provisionSignupAllocationInTx } from "./services/signup-allocation.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const password = "correct-horse-battery";

describe("paper account api", () => {
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

  it("returns 401 for unauthenticated /api/account", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/account",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 for unauthenticated /api/account/initialize", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/account/initialize",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
  });

  it("does not provision financial state from GET /api/account", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/account",
      headers: {
        cookie: cookieHeader(signup),
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "ACCOUNT_NOT_INITIALIZED",
    } satisfies AccountNotInitializedError);

    expect(await db.select().from(paperAccount)).toHaveLength(0);
    expect(await db.select().from(fundingEvent)).toHaveLength(0);
    expect(await db.select().from(ledgerTransaction)).toHaveLength(0);
  });

  it("initializes a funded account exactly once", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const signupBody = signup.json() as { user?: { id?: string } };
    const cookies = cookieHeader(signup);

    const initialized = await app.inject({
      method: "POST",
      url: "/api/account/initialize",
      headers: {
        cookie: cookies,
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(initialized.statusCode).toBe(200);

    const body = initialized.json() as AccountResponse;

    expect(body).toEqual({
      id: expect.stringMatching(UUID_PATTERN),
      userId: signupBody.user?.id,
      currency: "USDT",
      balance: expect.any(String),
      status: "ACTIVE",
      lastFaucetClaimAt: null,
      createdAt: expect.any(String),
    });
    expect(typeof body.balance).toBe("string");
    expect(fromDbDecimal(body.balance).eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(true);
    expect(body).not.toHaveProperty("password");
    expect(JSON.stringify(body)).not.toContain("password");

    await assertSingleAllocation(body.id);

    const read = await app.inject({
      method: "GET",
      url: "/api/account",
      headers: {
        cookie: cookies,
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(read.statusCode).toBe(200);
    const readBody = read.json() as AccountResponse;
    expect(readBody.id).toBe(body.id);
    expect(fromDbDecimal(readBody.balance).eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(
      true,
    );

    const repeated = await app.inject({
      method: "POST",
      url: "/api/account/initialize",
      headers: {
        cookie: cookies,
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(repeated.statusCode).toBe(200);
    const repeatedBody = repeated.json() as AccountResponse;
    expect(repeatedBody.id).toBe(body.id);
    expect(fromDbDecimal(repeatedBody.balance).eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(
      true,
    );
    await assertSingleAllocation(body.id);
  });

  it("credits an existing Phase 3 zero-balance paper account exactly once", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const signupBody = signup.json() as { user: { id: string } };
    const existing = await ensurePaperAccount(db, signupBody.user.id);
    expect(fromDbDecimal(existing.balance).isZero()).toBe(true);

    const before = await app.inject({
      method: "GET",
      url: "/api/account",
      headers: {
        cookie: cookieHeader(signup),
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(before.statusCode).toBe(409);

    const initialized = await app.inject({
      method: "POST",
      url: "/api/account/initialize",
      headers: {
        cookie: cookieHeader(signup),
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(initialized.statusCode).toBe(200);
    const body = initialized.json() as AccountResponse;
    expect(body.id).toBe(existing.id);
    expect(fromDbDecimal(body.balance).eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(true);
    await assertSingleAllocation(existing.id);
  });

  it("creates exactly one allocation under concurrent initialize calls", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const cookies = cookieHeader(signup);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: "POST",
          url: "/api/account/initialize",
          headers: {
            cookie: cookies,
            origin: process.env.WEB_ORIGIN,
          },
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(200);
    }

    const bodies = responses.map((response) => response.json() as AccountResponse);
    const ids = new Set(bodies.map((body) => body.id));
    expect(ids.size).toBe(1);

    for (const body of bodies) {
      expect(fromDbDecimal(body.balance).eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(true);
    }

    await assertSingleAllocation(bodies[0]!.id);
  });

  it("rolls back paper account, ledger, and funding when the financial transaction throws", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const signupBody = signup.json() as { user: { id: string } };

    await expect(
      db.transaction(async (tx) => {
        await provisionSignupAllocationInTx(tx, signupBody.user.id);
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    expect(await findPaperAccountByUserId(db, signupBody.user.id)).toBeNull();
    expect(await db.select().from(fundingEvent)).toHaveLength(0);
    expect(await db.select().from(ledgerTransaction)).toHaveLength(0);
    expect(await db.select().from(ledgerEntry)).toHaveLength(0);
    expect(await db.select().from(ledgerAccount)).toHaveLength(0);
  });
});

async function assertSingleAllocation(paperAccountId: string): Promise<void> {
  const paperAccounts = await db.select().from(paperAccount);
  expect(paperAccounts).toHaveLength(1);
  expect(paperAccounts[0]?.id).toBe(paperAccountId);
  expect(typeof paperAccounts[0]?.balance).toBe("string");
  expect(fromDbDecimal(paperAccounts[0]!.balance).eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(
    true,
  );

  const funding = await db.select().from(fundingEvent);
  expect(funding).toHaveLength(1);
  expect(funding[0]?.eventType).toBe("SIGNUP_ALLOCATION");
  expect(typeof funding[0]?.amount).toBe("string");
  expect(fromDbDecimal(funding[0]!.amount).eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(
    true,
  );

  const transactions = await db.select().from(ledgerTransaction);
  expect(transactions).toHaveLength(1);
  expect(transactions[0]?.eventType).toBe("SIGNUP_ALLOCATION");
  expect(transactions[0]?.id).toBe(funding[0]?.ledgerTransactionId);

  const entries = await db.select().from(ledgerEntry);
  expect(entries).toHaveLength(2);

  const ledgerAccounts = await db.select().from(ledgerAccount);
  const userCash = ledgerAccounts.filter((account) => account.kind === "USER_CASH");
  const systemFunding = ledgerAccounts.filter(
    (account) => account.kind === "SYSTEM_VIRTUAL_FUNDING",
  );

  expect(userCash).toHaveLength(1);
  expect(systemFunding).toHaveLength(1);

  const userCashEntry = entries.find(
    (entry) => entry.ledgerAccountId === userCash[0]?.id,
  );
  const systemEntry = entries.find(
    (entry) => entry.ledgerAccountId === systemFunding[0]?.id,
  );

  expect(userCashEntry).toBeDefined();
  expect(systemEntry).toBeDefined();
  expect(fromDbDecimal(userCashEntry!.amount).eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(
    true,
  );
  expect(
    fromDbDecimal(systemEntry!.amount).eq(SIGNUP_ALLOCATION_AMOUNT.negated()),
  ).toBe(true);

  const sum = fromDbDecimal(userCashEntry!.amount).plus(
    fromDbDecimal(systemEntry!.amount),
  );
  expect(sum.isZero()).toBe(true);
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

function cookieHeader(response: {
  cookies: Array<{ name: string; value: string }>;
}): string {
  return response.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}
