import { describe, expect, it } from "vitest";

import { createPrivateEventBus, type AccountClient } from "./private-bus.js";

function client(id: string, paperAccountId: string, bufferedAmount = 0): AccountClient & {
  sent: unknown[];
  closed?: { code: number; reason: string };
} {
  const sent: unknown[] = [];
  const row: AccountClient & {
    sent: unknown[];
    closed?: { code: number; reason: string };
  } = {
    id,
    paperAccountId,
    attachedAt: Number(id),
    sent,
    bufferedAmount: () => bufferedAmount,
    sendJson(payload) {
      if (id === "bad") {
        throw new Error("send failed");
      }
      sent.push(payload);
    },
    close(code, reason) {
      row.closed = { code, reason };
    },
  };
  return row;
}

describe("private event bus", () => {
  it("routes only to the matching account", () => {
    const bus = createPrivateEventBus({ clock: { now: () => 0 } });
    const a = client("1", "account-a");
    const b = client("2", "account-b");
    bus.add(a);
    bus.add(b);
    bus.publish({
      paperAccountId: "account-a",
      reason: "ORDER_PLACED",
      resources: ["orders"],
    });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(0);
    expect(a.sent[0]).toMatchObject({
      type: "private.invalidate",
      reason: "ORDER_PLACED",
      resources: ["orders"],
    });
  });

  it("closes an overloaded private socket instead of dropping silently", () => {
    const bus = createPrivateEventBus({
      clock: { now: () => 0 },
      backpressureBytes: 10,
    });
    const overloaded = client("1", "account-a", 50);
    bus.add(overloaded);
    bus.publish({
      paperAccountId: "account-a",
      reason: "ORDER_PLACED",
      resources: ["orders"],
    });
    expect(overloaded.sent).toHaveLength(0);
    expect(overloaded.closed).toEqual({ code: 4429, reason: "PRIVATE_BACKPRESSURE" });
  });

  it("contains a send failure so sibling sockets still receive the event", () => {
    const bus = createPrivateEventBus({ clock: { now: () => 0 } });
    const bad = client("bad", "account-a");
    const good = client("good", "account-a");
    bus.add(bad);
    bus.add(good);
    bus.publish({
      paperAccountId: "account-a",
      reason: "FAUCET_CLAIMED",
      resources: ["account", "walletFunding"],
    });
    expect(good.sent).toHaveLength(1);
    expect(bad.closed?.code).toBe(4429);
  });

  it("closes the oldest connection when the per-account cap is exceeded", () => {
    const bus = createPrivateEventBus({
      clock: { now: () => 0 },
      maxConnectionsPerAccount: 2,
    });
    const first = client("1", "account-a");
    const second = client("2", "account-a");
    const third = client("3", "account-a");
    bus.add(first);
    bus.add(second);
    bus.add(third);
    expect(first.closed).toEqual({ code: 1008, reason: "CONNECTION_LIMIT" });
    expect(bus.list("account-a").map((row) => row.id)).toEqual(["2", "3"]);
  });
});
