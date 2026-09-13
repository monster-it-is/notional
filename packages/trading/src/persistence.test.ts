import { describe, expect, it } from "vitest";

import { assertFitsNumeric3818, quantizeToNumeric3818 } from "./decimal.js";
import { satisfiesMinNotional } from "./filters.js";
import { applyFillToPosition } from "./position.js";
import { expectTradingCode, fractionalDigitCount } from "./test-helpers.js";

describe("persistence and quantization rules", () => {
  it("keeps exact quantity addition exact", () => {
    const result = applyFillToPosition({
      currentQty: "0.1",
      currentEntryPrice: "100",
      fillSide: "BUY",
      fillQty: "0.2",
      fillPrice: "100",
    });
    expect(result.nextQty).toBe("0.3");
  });

  it("rejects quantities outside NUMERIC(38,18) rather than rounding them", () => {
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: "1.1234567890123456789",
          currentEntryPrice: "100",
          fillSide: "BUY",
          fillQty: "1",
          fillPrice: "100",
        }),
      "OVERFLOW",
    );
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: "0",
          currentEntryPrice: null,
          fillSide: "BUY",
          fillQty: "1.1234567890123456789",
          fillPrice: "100",
        }),
      "OVERFLOW",
    );
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: "9".repeat(20),
          currentEntryPrice: "100",
          fillSide: "BUY",
          fillQty: "1",
          fillPrice: "100",
        }),
      "OVERFLOW",
    );
  });

  it("does not silently round a fill price onto database scale", () => {
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: "0",
          currentEntryPrice: null,
          fillSide: "BUY",
          fillQty: "1",
          fillPrice: "1.1234567890123456789",
        }),
      "OVERFLOW",
    );
    expectTradingCode(
      () => assertFitsNumeric3818("1.1234567890123456789"),
      "OVERFLOW",
    );
  });

  it("allows a weighted average to exceed 18 fractional digits", () => {
    const result = applyFillToPosition({
      currentQty: "0.5",
      currentEntryPrice: "100.5",
      fillSide: "BUY",
      fillQty: "0.25",
      fillPrice: "99.5",
    });
    expect(result.transition).toBe("INCREASE");
    expect(result.nextQty).toBe("0.75");
    expect(result.realizedPnl).toBe("0");
    expect(fractionalDigitCount(result.nextEntryPrice!)).toBeGreaterThan(18);
    expect(result.nextEntryPrice!.startsWith("100.1")).toBe(true);
  });

  it("quantizes a weighted average with ROUND_HALF_EVEN only when asked", () => {
    const result = applyFillToPosition({
      currentQty: "0.5",
      currentEntryPrice: "100.5",
      fillSide: "BUY",
      fillQty: "0.25",
      fillPrice: "99.5",
    });
    expect(result.nextEntryPrice).not.toBe(
      quantizeToNumeric3818(result.nextEntryPrice!),
    );
    expect(quantizeToNumeric3818(result.nextEntryPrice!)).toBe(
      "100.166666666666666667",
    );
  });

  it("quantizes realized PnL only through the explicit helper", () => {
    const result = applyFillToPosition({
      currentQty: "0.000000000000000003",
      currentEntryPrice: "1.000000000000000003",
      fillSide: "SELL",
      fillQty: "0.000000000000000003",
      fillPrice: "1.000000000000000001",
    });
    expect(fractionalDigitCount(result.realizedPnl)).toBeGreaterThan(18);
    expect(quantizeToNumeric3818(result.realizedPnl)).toBe("0");
  });

  it("compares MIN_NOTIONAL before quantization", () => {
    expect(
      satisfiesMinNotional({
        quantity: "0.000000000000000001",
        price: "0.6",
        minNotional: "0.000000000000000001",
      }),
    ).toBe(false);
    expect(quantizeToNumeric3818("0.0000000000000000006")).toBe(
      "0.000000000000000001",
    );
  });

  it("treats quantization carry as overflow", () => {
    expectTradingCode(
      () => quantizeToNumeric3818(`${"9".repeat(20)}.${"9".repeat(18)}5`),
      "OVERFLOW",
    );
  });

  it("uses the committed quantized entry as the next transition cost basis", () => {
    const increased = applyFillToPosition({
      currentQty: "0.5",
      currentEntryPrice: "100.5",
      fillSide: "BUY",
      fillQty: "0.25",
      fillPrice: "99.5",
    });
    const persistedEntry = quantizeToNumeric3818(increased.nextEntryPrice!);
    const reduced = applyFillToPosition({
      currentQty: increased.nextQty,
      currentEntryPrice: persistedEntry,
      fillSide: "SELL",
      fillQty: "0.25",
      fillPrice: "110",
    });

    expect(reduced.transition).toBe("REDUCE");
    expect(reduced.nextEntryPrice).toBe(persistedEntry);
    expect(reduced.realizedPnl).toBe(
      applyFillToPosition({
        currentQty: increased.nextQty,
        currentEntryPrice: persistedEntry,
        fillSide: "SELL",
        fillQty: "0.25",
        fillPrice: "110",
      }).realizedPnl,
    );
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: increased.nextQty,
          currentEntryPrice: increased.nextEntryPrice,
          fillSide: "SELL",
          fillQty: "0.25",
          fillPrice: "110",
        }),
      "OVERFLOW",
    );
  });

  it("never emits negative zero", () => {
    const closed = applyFillToPosition({
      currentQty: "-1",
      currentEntryPrice: "50",
      fillSide: "BUY",
      fillQty: "1",
      fillPrice: "50",
    });
    expect(closed.nextQty).toBe("0");
    expect(closed.realizedPnl).toBe("0");
    expect(quantizeToNumeric3818("-0.0000000000000000004")).toBe("0");
  });
});
