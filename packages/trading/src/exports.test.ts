import { describe, expect, it } from "vitest";

import * as trading from "./index.js";

describe("public package boundary", () => {
  it("exposes string-based domain functions and does not re-export Decimal internals", () => {
    expect(Object.hasOwn(trading, "TradingDecimal")).toBe(false);
    expect(Object.hasOwn(trading, "realizedPnlValue")).toBe(false);
    expect(typeof trading.calculateRealizedPnl).toBe("function");
    expect(typeof trading.calculateUnrealizedPnl).toBe("function");
    expect(typeof trading.applyFillToPosition).toBe("function");
    expect(typeof trading.classifyPositionTransition).toBe("function");
    expect(typeof trading.satisfiesMinNotional).toBe("function");
    expect(typeof trading.calculateInitialMargin).toBe("function");
    expect(typeof trading.assertFitsNumeric3818).toBe("function");
    expect(typeof trading.quantizeToNumeric3818).toBe("function");
    expect(typeof trading.TradingMathError).toBe("function");
  });
});
