import { db, fundingEvent, ledgerTransaction, paperAccount, upsertInstrumentBySymbol } from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { buildApp } from "../app.js";
import { env } from "../env.js";
import { createMarketDataStore } from "../market-data/market-data-store.js";
import { FakeScheduler } from "../market-data/test-helpers.js";
import { createRealtimeRuntime, latestFromStore } from "./runtime.js";

const password = "correct-horse-battery";

describe("websocket http upgrade", () => {
  let app: FastifyInstance;
  let runtime: ReturnType<typeof createRealtimeRuntime>;
  let scheduler: FakeScheduler;
  let store: ReturnType<typeof createMarketDataStore>;

  beforeEach(async () => {
    await resetTestTables();
    scheduler = new FakeScheduler();
    store = createMarketDataStore(scheduler);
    runtime = createRealtimeRuntime({
      latest: latestFromStore(store),
      scheduler,
      coalesceMs: 100,
      idleTimeoutMs: 45_000,
    });
    app = await buildApp({ realtime: runtime });
    await app.listen({ port: 0, host: "127.0.0.1" });
    lastApp = app;
  });

  afterEach(async () => {
    await runtime.shutdown();
    await app.close();
  });

  afterAll(async () => {
    await endTestPool();
  });

  it("rejects missing and wrong Origin before upgrade", async () => {
    await expectStatus("/ws/market", {}, 403);
    await expectStatus("/ws/market", { Origin: "http://evil.example" }, 403);
    await expectStatus("/ws/account", { Origin: env.WEB_ORIGIN }, 401);
  });

  it("opens a public market socket and sends hello first", async () => {
    const session = await openSocket("/ws/market", { Origin: env.WEB_ORIGIN });
    expect(session.messages[0]).toMatchObject({
      type: "hello",
      protocolVersion: 1,
      channel: "market",
    });
    session.ws.close();
  });

  it("subscribes to a catalog symbol and sends the current store snapshot", async () => {
    await upsertInstrumentBySymbol(db, {
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      status: "ACTIVE",
      tickSize: "0.1",
      minPrice: "0.1",
      maxPrice: "1000000",
      stepSize: "0.001",
      minQty: "0.001",
      maxQty: "1000",
      marketStepSize: "0.001",
      marketMinQty: "0.001",
      marketMaxQty: "120",
      minNotional: "5",
    });
    store.applyBook({
      symbol: "BTCUSDT",
      bestBidPrice: "100",
      bestBidQty: "1",
      bestAskPrice: "101",
      bestAskQty: "1",
      bookUpdateId: 1,
      bookEventTime: 1,
    });
    const session = await openSocket("/ws/market", { Origin: env.WEB_ORIGIN });
    session.ws.send(JSON.stringify({ type: "market.subscribe", symbol: "BTCUSDT" }));
    await waitForMessage(session, (row) => (row as { type: string }).type === "market.bbo");
    expect(session.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "hello", channel: "market" }),
        expect.objectContaining({ type: "market.bbo", bestBidPrice: "100" }),
      ]),
    );
    session.ws.close();
  });

  it("rejects uninitialized private sockets without writing financial state", async () => {
    const cookies = await signUp(app, "ws-uninit@example.com");
    const beforeAccounts = await db.select().from(paperAccount);
    const beforeFunding = await db.select().from(fundingEvent);
    const beforeLedger = await db.select().from(ledgerTransaction);
    await expectStatus(
      "/ws/account",
      { Origin: env.WEB_ORIGIN, Cookie: cookies },
      409,
    );
    expect(await db.select().from(paperAccount)).toEqual(beforeAccounts);
    expect(await db.select().from(fundingEvent)).toEqual(beforeFunding);
    expect(await db.select().from(ledgerTransaction)).toEqual(beforeLedger);
  });

  it("binds a private socket to the server-side account and isolates accounts", async () => {
    const first = await signUpAndInitialize(app, "ws-a@example.com");
    const second = await signUpAndInitialize(app, "ws-b@example.com");
    const socketA = await openSocket("/ws/account", {
      Origin: env.WEB_ORIGIN,
      Cookie: first.cookies,
    });
    const socketB = await openSocket("/ws/account", {
      Origin: env.WEB_ORIGIN,
      Cookie: second.cookies,
    });
    expect(socketA.messages[0]).toMatchObject({ type: "hello", channel: "account" });
    runtime.onPrivateCommitted({
      paperAccountId: first.accountId,
      reason: "FAUCET_CLAIMED",
      resources: ["account", "walletFunding"],
    });
    await waitForMessage(socketA, (row) => (row as { type: string }).type === "private.invalidate");
    expect(
      socketB.messages.some((row) => (row as { type: string }).type === "private.invalidate"),
    ).toBe(false);
    socketA.ws.close();
    socketB.ws.close();
  });

  it("does not replay private events after reconnect", async () => {
    const user = await signUpAndInitialize(app, "ws-reconnect@example.com");
    const first = await openSocket("/ws/account", {
      Origin: env.WEB_ORIGIN,
      Cookie: user.cookies,
    });
    runtime.onPrivateCommitted({
      paperAccountId: user.accountId,
      reason: "ORDER_PLACED",
      resources: ["orders"],
    });
    await waitForMessage(first, (row) => (row as { type: string }).type === "private.invalidate");
    first.ws.close();
    const second = await openSocket("/ws/account", {
      Origin: env.WEB_ORIGIN,
      Cookie: user.cookies,
    });
    expect(second.messages.some((row) => (row as { type: string }).type === "private.invalidate")).toBe(
      false,
    );
    second.ws.close();
  });
});

describe("buildApp realtime lifecycle", () => {
  it("does not construct production runtimes in app.ts", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app.ts"), "utf8");
    expect(source).not.toContain("createRealtimeRuntime");
    expect(source).not.toContain("createMarketDataRuntime");
    expect(source).not.toContain("createLimitOrderMatcher");
    expect(source).not.toContain("createFundingScanner");
    expect(source).not.toContain("createLiquidationScanner");
  });
});

async function expectStatus(
  path: string,
  headers: Record<string, string>,
  status: number,
): Promise<void> {
  const address = currentAddress();
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://${address}${path}`, { headers });
    ws.once("unexpected-response", (_req, res) => {
      expect(res.statusCode).toBe(status);
      res.resume();
      ws.terminate();
      resolve();
    });
    ws.once("open", () => {
      ws.close();
      reject(new Error(`expected ${status} but upgraded`));
    });
    ws.once("error", () => {
      // The client also emits error after a failed upgrade; ignore it.
    });
  });
}

async function openSocket(
  path: string,
  headers: Record<string, string>,
): Promise<{ ws: WebSocket; messages: unknown[] }> {
  const address = currentAddress();
  const messages: unknown[] = [];
  const ws = new WebSocket(`ws://${address}${path}`, { headers });
  ws.on("message", (data) => {
    messages.push(JSON.parse(String(data)) as unknown);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => {
      reject(new Error(`upgrade failed ${res.statusCode}`));
    });
  });
  await new Promise<void>((resolve, reject) => {
    if (messages.length > 0) {
      resolve();
      return;
    }
    const onMessage = () => {
      ws.off("message", onMessage);
      resolve();
    };
    ws.on("message", onMessage);
    ws.once("error", reject);
    ws.once("close", () => {
      if (messages.length === 0) {
        reject(new Error("socket closed before hello"));
      }
    });
  });
  return { ws, messages };
}

function currentAddress(): string {
  return listenAddress();
}

let lastApp: FastifyInstance | undefined;

function listenAddress(): string {
  const app = lastApp;
  if (!app) {
    throw new Error("app not listening");
  }
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing listen address");
  }
  return `127.0.0.1:${address.port}`;
}

async function signUp(app: FastifyInstance, email: string): Promise<string> {
  const signup = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: env.WEB_ORIGIN },
    payload: { name: "Ada Lovelace", email, password },
  });
  return signup.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function signUpAndInitialize(app: FastifyInstance, email: string) {
  const cookies = await signUp(app, email);
  const initialized = await app.inject({
    method: "POST",
    url: "/api/account/initialize",
    headers: { cookie: cookies, origin: env.WEB_ORIGIN },
  });
  expect(initialized.statusCode).toBe(200);
  const account = (await db.select().from(paperAccount)).at(-1);
  if (!account) {
    throw new Error("expected paper account");
  }
  return { cookies, accountId: account.id };
}

async function waitForMessage(
  session: { ws: WebSocket; messages: unknown[] },
  predicate: (row: unknown) => boolean,
): Promise<void> {
  if (session.messages.some(predicate)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onMessage = () => {
      if (session.messages.some(predicate)) {
        session.ws.off("message", onMessage);
        resolve();
      }
    };
    session.ws.on("message", onMessage);
    session.ws.once("error", reject);
    session.ws.once("close", () => {
      if (!session.messages.some(predicate)) {
        reject(new Error("socket closed before expected message"));
      }
    });
  });
}
