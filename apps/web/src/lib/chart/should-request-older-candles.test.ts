import { describe, expect, it } from "vitest";

import {
  BACKFILL_LOGICAL_THRESHOLD,
  shouldRequestOlderCandles,
} from "./should-request-older-candles.ts";

describe("shouldRequestOlderCandles", () => {
  it("does not backfill when barsInLogicalRange is null", () => {
    expect(shouldRequestOlderCandles(null)).toBe(false);
  });

  it("does not backfill a fitContent overview", () => {
    expect(shouldRequestOlderCandles({ barsBefore: 0, barsAfter: 0 })).toBe(false);
    expect(shouldRequestOlderCandles({ barsBefore: 10, barsAfter: 10 })).toBe(false);
  });

  it("backfills when the left edge is near and newer bars are offscreen", () => {
    expect(
      shouldRequestOlderCandles({
        barsBefore: BACKFILL_LOGICAL_THRESHOLD - 1,
        barsAfter: BACKFILL_LOGICAL_THRESHOLD + 1,
      }),
    ).toBe(true);
  });

  it("does not backfill when the left edge still has a deep buffer", () => {
    expect(
      shouldRequestOlderCandles({
        barsBefore: BACKFILL_LOGICAL_THRESHOLD,
        barsAfter: BACKFILL_LOGICAL_THRESHOLD + 1,
      }),
    ).toBe(false);
  });

  it("does not backfill when there is not enough newer data offscreen", () => {
    expect(
      shouldRequestOlderCandles({
        barsBefore: 0,
        barsAfter: BACKFILL_LOGICAL_THRESHOLD,
      }),
    ).toBe(false);
  });
});
