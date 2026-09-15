import { describe, expect, it } from "vitest";

import { db } from "@notional/db";
import { silentLogger } from "../market-data/types.js";
import {
  accountInitializedEffect,
  cancelOrderEffect,
  faucetEffect,
  fundingSettledEffect,
  liquidationEffect,
  marginSettingsEffect,
  matcherEffect,
  placeOrderEffect,
  safeOnPrivateCommitted,
} from "./effects.js";

describe("post-commit realtime isolation", () => {
  it("does not publish when there is no effect", () => {
    let called = false;
    safeOnPrivateCommitted(
      () => {
        called = true;
      },
      placeOrderEffect({
        paperAccountId: "a",
        created: false,
        status: "OPEN",
        settledFunding: true,
      }),
      silentLogger,
    );
    expect(called).toBe(false);
  });

  it("swallows realtime callback errors after commit", () => {
    expect(() =>
      safeOnPrivateCommitted(
        () => {
          throw new Error("fanout down");
        },
        {
          paperAccountId: "a",
          reason: "ORDER_PLACED",
          resources: ["orders"],
        },
        silentLogger,
      ),
    ).not.toThrow();
  });

  it("does not treat a database error as a realtime failure", async () => {
    await expect(
      db.transaction(async () => {
        throw new Error("financial boom");
      }),
    ).rejects.toThrow("financial boom");
  });

  it("maps matcher fill, no-op, and funding-only commits", () => {
    expect(
      matcherEffect({
        paperAccountId: "a",
        filled: true,
        settledFunding: false,
      }),
    ).toEqual({
      paperAccountId: "a",
      reason: "LIMIT_MATCHED",
      resources: ["orders", "executions", "positions", "account"],
    });
    expect(
      matcherEffect({
        paperAccountId: "a",
        filled: false,
        settledFunding: true,
      }),
    ).toEqual({
      paperAccountId: "a",
      reason: "FUNDING_SETTLED",
      resources: ["account", "positions", "perpFunding"],
    });
    expect(
      matcherEffect({
        paperAccountId: "a",
        filled: false,
        settledFunding: false,
      }),
    ).toBeNull();
  });

  it("maps the committed invalidation matrix", () => {
    expect(
      placeOrderEffect({
        paperAccountId: "a",
        created: true,
        status: "OPEN",
        settledFunding: false,
      }),
    ).toEqual({
      paperAccountId: "a",
      reason: "ORDER_PLACED",
      resources: ["orders"],
    });
    expect(
      placeOrderEffect({
        paperAccountId: "a",
        created: true,
        status: "OPEN",
        settledFunding: true,
      }),
    ).toEqual({
      paperAccountId: "a",
      reason: "ORDER_PLACED",
      resources: ["orders", "account", "positions", "perpFunding"],
    });
    expect(
      placeOrderEffect({
        paperAccountId: "a",
        created: true,
        status: "FILLED",
        settledFunding: true,
      }),
    ).toEqual({
      paperAccountId: "a",
      reason: "ORDER_FILLED",
      resources: ["orders", "executions", "positions", "account", "perpFunding"],
    });
    expect(cancelOrderEffect("a")).toEqual({
      paperAccountId: "a",
      reason: "ORDER_CANCELLED",
      resources: ["orders"],
    });
    expect(
      liquidationEffect({
        paperAccountId: "a",
        liquidated: true,
        settledFunding: false,
      }),
    ).toEqual({
      paperAccountId: "a",
      reason: "LIQUIDATION",
      resources: ["liquidations", "orders", "executions", "positions", "account"],
    });
    expect(
      liquidationEffect({
        paperAccountId: "a",
        liquidated: false,
        settledFunding: true,
      }),
    ).toEqual({
      paperAccountId: "a",
      reason: "FUNDING_SETTLED",
      resources: ["account", "positions", "perpFunding"],
    });
    expect(fundingSettledEffect("a")).toEqual({
      paperAccountId: "a",
      reason: "FUNDING_SETTLED",
      resources: ["account", "positions", "perpFunding"],
    });
    expect(faucetEffect({ paperAccountId: "a", settledFunding: false })).toEqual({
      paperAccountId: "a",
      reason: "FAUCET_CLAIMED",
      resources: ["account", "walletFunding"],
    });
    expect(marginSettingsEffect("a")).toEqual({
      paperAccountId: "a",
      reason: "MARGIN_SETTINGS_CHANGED",
      resources: ["marginSettings"],
    });
    expect(accountInitializedEffect("a")).toEqual({
      paperAccountId: "a",
      reason: "ACCOUNT_INITIALIZED",
      resources: ["account", "walletFunding"],
    });
  });

  it("does not publish after a rolled-back transaction", async () => {
    let published = false;
    await expect(
      (async () => {
        await db.transaction(async () => {
          throw new Error("rollback");
        });
        safeOnPrivateCommitted(
          () => {
            published = true;
          },
          placeOrderEffect({
            paperAccountId: "a",
            created: true,
            status: "OPEN",
            settledFunding: false,
          }),
          silentLogger,
        );
      })(),
    ).rejects.toThrow("rollback");
    expect(published).toBe(false);
  });

  it("publishes only after a committed transaction", async () => {
    const events: string[] = [];
    await db.transaction(async () => ({ ok: true }));
    safeOnPrivateCommitted(
      (effect) => {
        events.push(effect.reason);
      },
      placeOrderEffect({
        paperAccountId: "a",
        created: true,
        status: "OPEN",
        settledFunding: false,
      }),
      silentLogger,
    );
    expect(events).toEqual(["ORDER_PLACED"]);
  });
});
