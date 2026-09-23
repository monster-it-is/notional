import { describe, expect, it } from "vitest";

import {
  createSymbolCycleScheduler,
  resolvePositiveInteger,
} from "./symbol-cycle-scheduler.js";

describe("resolvePositiveInteger", () => {
  it("accepts positive integers and rejects other values", () => {
    expect(resolvePositiveInteger(1, "maxConcurrentSymbols")).toBe(1);
    expect(resolvePositiveInteger(4, "maxConcurrentSymbols")).toBe(4);
    expect(() => resolvePositiveInteger(0, "maxConcurrentSymbols")).toThrow(
      "maxConcurrentSymbols must be a positive integer",
    );
    expect(() => resolvePositiveInteger(-1, "maxConcurrent")).toThrow(
      "maxConcurrent must be a positive integer",
    );
    expect(() => resolvePositiveInteger(1.5, "maxConcurrent")).toThrow(
      "maxConcurrent must be a positive integer",
    );
    expect(() => resolvePositiveInteger(Number.NaN, "maxConcurrent")).toThrow(
      "maxConcurrent must be a positive integer",
    );
    expect(() => resolvePositiveInteger(Number.POSITIVE_INFINITY, "maxConcurrent")).toThrow(
      "maxConcurrent must be a positive integer",
    );
  });
});

describe("symbol cycle scheduler", () => {
  it("never runs more than maxConcurrent symbol cycles at once", async () => {
    const harness = createHarness(4);
    for (const symbol of numbered(10)) {
      harness.scheduler.schedule(symbol);
    }

    expect(harness.started).toEqual(numbered(4));
    expect(harness.active).toBe(4);
    expect(harness.maxActive).toBe(4);

    harness.release("S1");
    await harness.waitUntilRunCount("S5", 1);
    expect(harness.active).toBe(4);
    expect(harness.maxActive).toBe(4);

    for (const symbol of numbered(10)) {
      harness.release(symbol);
    }
    await harness.scheduler.waitForIdle();
    expect(harness.started).toEqual(numbered(10));
    expect(harness.maxActive).toBe(4);
    expect(harness.active).toBe(0);
  });

  it("drains a bounded pending queue until every scheduled symbol has run", async () => {
    const harness = createHarness(4);
    for (const symbol of numbered(20)) {
      harness.scheduler.schedule(symbol);
    }

    expect(harness.started).toEqual(numbered(4));

    for (const symbol of numbered(20)) {
      harness.release(symbol);
      const nextIndex = Number(symbol.slice(1)) + 4;
      if (nextIndex <= 20) {
        await harness.waitUntilRunCount(`S${nextIndex}`, 1);
      }
    }

    await harness.scheduler.waitForIdle();
    expect(harness.started).toEqual(numbered(20));
    expect(harness.runCounts()).toEqual(Object.fromEntries(numbered(20).map((symbol) => [symbol, 1])));
    expect(harness.maxActive).toBe(4);
  });

  it("coalesces repeated schedules for a queued symbol into one pending entry", async () => {
    const harness = createHarness(1);
    harness.scheduler.schedule("HOLD");
    harness.scheduler.schedule("QUEUED");
    harness.scheduler.schedule("QUEUED");
    harness.scheduler.schedule("QUEUED");

    expect(harness.started).toEqual(["HOLD"]);
    harness.release("HOLD");
    await harness.waitUntilRunCount("QUEUED", 1);
    harness.release("QUEUED");
    await harness.scheduler.waitForIdle();

    expect(harness.started).toEqual(["HOLD", "QUEUED"]);
    expect(harness.runCount("QUEUED")).toBe(1);
  });

  it("runs exactly one follow-up cycle when an event arrives while a symbol is active", async () => {
    const harness = createHarness(1);
    harness.scheduler.schedule("BTCUSDT");
    await harness.waitUntilRunCount("BTCUSDT", 1);
    harness.scheduler.schedule("BTCUSDT");
    harness.scheduler.schedule("BTCUSDT");
    harness.release("BTCUSDT");
    await harness.waitUntilRunCount("BTCUSDT", 2);
    harness.release("BTCUSDT");
    await harness.scheduler.waitForIdle();
    expect(harness.runCount("BTCUSDT")).toBe(2);
    expect(harness.started).toEqual(["BTCUSDT", "BTCUSDT"]);
  });

  it("does not start a second run for events that arrive while a symbol is still queued", async () => {
    const harness = createHarness(1);
    harness.scheduler.schedule("HOLD");
    harness.scheduler.schedule("ETHUSDT");
    harness.scheduler.schedule("ETHUSDT");
    harness.scheduler.schedule("ETHUSDT");

    expect(harness.started).toEqual(["HOLD"]);
    harness.release("HOLD");
    await harness.waitUntilRunCount("ETHUSDT", 1);
    harness.release("ETHUSDT");
    await harness.scheduler.waitForIdle();

    expect(harness.started).toEqual(["HOLD", "ETHUSDT"]);
    expect(harness.runCount("ETHUSDT")).toBe(1);
  });

  it("starts distinct queued symbols in FIFO order", async () => {
    const harness = createHarness(1);
    harness.scheduler.schedule("HOLD");
    harness.scheduler.schedule("A");
    harness.scheduler.schedule("B");
    harness.scheduler.schedule("C");

    harness.release("HOLD");
    await harness.waitUntilRunCount("A", 1);
    harness.release("A");
    await harness.waitUntilRunCount("B", 1);
    harness.release("B");
    await harness.waitUntilRunCount("C", 1);
    harness.release("C");
    await harness.scheduler.waitForIdle();

    expect(harness.started).toEqual(["HOLD", "A", "B", "C"]);
  });

  it("releases a concurrency slot when a symbol cycle throws", async () => {
    const harness = createHarness(1, new Set(["THROW"]));
    harness.scheduler.schedule("THROW");
    harness.scheduler.schedule("NEXT");
    await harness.waitUntilRunCount("NEXT", 1);
    expect(harness.started).toEqual(["THROW", "NEXT"]);
    expect(harness.errors).toEqual([{ symbol: "THROW", error: expect.any(Error) }]);
    expect(harness.maxActive).toBe(1);
    harness.release("NEXT");
    await harness.scheduler.waitForIdle();
    expect(harness.active).toBe(0);
  });

  it("stop drops pending work, ignores new schedules, and drains already active cycles", async () => {
    const harness = createHarness(2);
    harness.scheduler.schedule("A");
    harness.scheduler.schedule("B");
    harness.scheduler.schedule("C");
    harness.scheduler.schedule("D");
    expect(harness.started).toEqual(["A", "B"]);

    let idle = false;
    const waiting = harness.scheduler.waitForIdle().then(() => {
      idle = true;
    });
    harness.scheduler.stop();
    harness.scheduler.schedule("E");
    await Promise.resolve();
    expect(idle).toBe(false);
    expect(harness.started).toEqual(["A", "B"]);

    harness.release("A");
    harness.release("B");
    await waiting;
    expect(idle).toBe(true);
    expect(harness.started).toEqual(["A", "B"]);
    expect(harness.runCount("C")).toBe(0);
    expect(harness.runCount("D")).toBe(0);
    expect(harness.runCount("E")).toBe(0);

    harness.scheduler.schedule("F");
    await harness.scheduler.waitForIdle();
    expect(harness.started).toEqual(["A", "B"]);
  });

  it("does not launch a dirty follow-up after stop", async () => {
    const harness = createHarness(1);
    harness.scheduler.schedule("BTCUSDT");
    await harness.waitUntilRunCount("BTCUSDT", 1);
    harness.scheduler.schedule("BTCUSDT");
    harness.scheduler.stop();
    harness.release("BTCUSDT");
    await harness.scheduler.waitForIdle();
    expect(harness.runCount("BTCUSDT")).toBe(1);
  });
});

function numbered(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `S${index + 1}`);
}

function createHarness(maxConcurrent: number, throwOn = new Set<string>()) {
  const started: string[] = [];
  const errors: Array<{ symbol: string; error: unknown }> = [];
  const counts = new Map<string, number>();
  const gate = createPermitGate();
  let active = 0;
  let maxActive = 0;

  const scheduler = createSymbolCycleScheduler({
    maxConcurrent,
    async run(symbol) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(symbol);
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
      try {
        if (throwOn.has(symbol)) {
          throw new Error(`${symbol} failed`);
        }

        await gate.wait(symbol);
      } finally {
        active -= 1;
      }
    },
    onError(symbol, error) {
      errors.push({ symbol, error });
    },
  });

  return {
    scheduler,
    started,
    errors,
    get active() {
      return active;
    },
    get maxActive() {
      return maxActive;
    },
    runCount(symbol: string) {
      return counts.get(symbol) ?? 0;
    },
    runCounts() {
      return Object.fromEntries(counts);
    },
    release(symbol: string) {
      gate.release(symbol);
    },
    waitUntilRunCount(symbol: string, count: number) {
      return waitUntil(() => (counts.get(symbol) ?? 0) >= count);
    },
  };
}

function createPermitGate() {
  const permits = new Map<string, number>();
  const waiters = new Map<string, Array<() => void>>();

  return {
    wait(symbol: string) {
      const available = permits.get(symbol) ?? 0;
      if (available > 0) {
        permits.set(symbol, available - 1);
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        const queue = waiters.get(symbol) ?? [];
        queue.push(resolve);
        waiters.set(symbol, queue);
      });
    },
    release(symbol: string) {
      const queue = waiters.get(symbol);
      const waiter = queue?.shift();
      if (waiter) {
        waiter();
        return;
      }

      permits.set(symbol, (permits.get(symbol) ?? 0) + 1);
    },
  };
}

function waitUntil(predicate: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }

      queueMicrotask(check);
    };
    check();
  });
}
