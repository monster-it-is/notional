import { afterEach, describe, expect, it } from "vitest";

import { resetRuntimeStatusForTests, getRuntimeStatus } from "./runtime-status.js";
import { resetShutdownForTests, shutdownOnce } from "./shutdown.js";

afterEach(() => {
  resetShutdownForTests();
  resetRuntimeStatusForTests();
});

describe("shutdown coordinator", () => {
  it("drains workers, closes the pool last, and is idempotent", async () => {
    const order: string[] = [];
    let tickEnabled = true;
    const deferred = createDeferred();
    const resources = fakeResources({
      order,
      tickEnabled: () => tickEnabled,
      disableTickScheduling: () => {
        tickEnabled = false;
        order.push("disable-ticks");
      },
      fundingIdle: deferred.promise,
    });

    const first = shutdownOnce(resources);
    const second = shutdownOnce(resources);
    expect(getRuntimeStatus()).toEqual({ runtimeReady: false, shuttingDown: true });
    expect(order).not.toContain("pool");

    deferred.resolve();
    await first;
    await second;
    expect(order.filter((item) => item === "pool")).toEqual(["pool"]);
    expect(order.filter((item) => item === "realtime")).toEqual(["realtime"]);
    expect(order.indexOf("http-close-start")).toBeGreaterThan(-1);
    expect(order.indexOf("http-close-start")).toBeLessThan(order.indexOf("realtime"));
    expect(order.indexOf("funding-stop")).toBeGreaterThan(-1);
    expect(order.indexOf("funding-idle")).toBeGreaterThan(order.indexOf("funding-stop"));
    expect(order.indexOf("matcher-stop")).toBeGreaterThan(order.indexOf("http-close-done"));
    expect(order.indexOf("matcher-idle")).toBeGreaterThan(order.indexOf("http-close-done"));
    expect(order.indexOf("pool")).toBe(order.length - 1);
    expect(order.indexOf("market-stop")).toBeLessThan(order.indexOf("pool"));
  });

  it("times out without hanging the process timer", async () => {
    const exits: number[] = [];
    const deferred = createDeferred();
    await shutdownOnce(
      fakeResources({
        order: [],
        tickEnabled: () => true,
        disableTickScheduling: () => {},
        fundingIdle: deferred.promise,
        timeoutMs: 5,
        exit: (code) => {
          exits.push(code);
        },
      }),
    );
    expect(exits).toEqual([1]);
    deferred.resolve();
  });

  it("exits once when cleanup fails and does not run cleanup twice", async () => {
    const order: string[] = [];
    const exits: number[] = [];
    const resources = fakeResources({
      order,
      tickEnabled: () => true,
      disableTickScheduling: () => {
        order.push("disable-ticks");
      },
      fundingIdle: Promise.resolve(),
      realtimeError: new Error("socket close failed"),
      exit: (code) => {
        exits.push(code);
      },
    });

    const first = shutdownOnce(resources);
    const second = shutdownOnce(resources);
    await first;
    await second;

    expect(exits).toEqual([1]);
    expect(order.filter((item) => item === "http-close-start")).toEqual(["http-close-start"]);
    expect(order.filter((item) => item === "realtime")).toEqual(["realtime"]);
    expect(order.filter((item) => item === "pool")).toEqual([]);
    expect(order.filter((item) => item === "matcher-stop")).toEqual([]);
  });
});

function createDeferred() {
  let resolve = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fakeResources(options: {
  order: string[];
  tickEnabled: () => boolean;
  disableTickScheduling: () => void;
  fundingIdle: Promise<void>;
  timeoutMs?: number;
  exit?: (code: number) => void;
  realtimeError?: Error;
}) {
  return {
    app: {
      async close() {
        options.order.push("http-close-start");
        await Promise.resolve();
        options.order.push("http-close-done");
      },
    } as never,
    matcher: {
      stop() {
        options.order.push("matcher-stop");
      },
      async waitForIdle() {
        options.order.push("matcher-idle");
      },
    },
    fundingScanner: {
      stop() {
        options.order.push("funding-stop");
      },
      async waitForIdle() {
        await options.fundingIdle;
        options.order.push("funding-idle");
      },
    },
    liquidationScanner: {
      stop() {
        options.order.push("liquidation-stop");
      },
      async waitForIdle() {
        options.order.push("liquidation-idle");
      },
    },
    realtime: {
      async shutdown() {
        options.order.push("realtime");
        if (options.realtimeError) {
          throw options.realtimeError;
        }
      },
    },
    marketData: {
      stopScheduling() {
        options.order.push("catalog-stop");
      },
      async waitForSyncIdle() {
        options.order.push("catalog-idle");
      },
      async stop() {
        options.order.push("market-stop");
      },
    },
    disableTickScheduling: options.disableTickScheduling,
    timeoutMs: options.timeoutMs ?? 5_000,
    logger: { info() {}, warn() {}, error() {} },
    closePool: async () => {
      options.order.push("pool");
    },
    exit: options.exit,
  };
}
