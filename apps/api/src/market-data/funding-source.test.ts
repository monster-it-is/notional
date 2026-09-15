import { describe, expect, it } from "vitest";

import { expectedMarkCandleCloseTimeMs } from "@notional/trading";

import {
  expectedMarkCandleOpenTimeMs,
  FundingSourceError,
  parseMarkPriceKlines,
  parseRealizedFundingRate,
  parseRealizedFundingRates,
  selectExactSettlementMark,
} from "./funding-source.js";

describe("funding source parsers", () => {
  it("accepts signed plain rates and rejects abs>=1, scientific, and mismatched symbols", () => {
    expect(
      parseRealizedFundingRate(
        { symbol: "BTCUSDT", fundingTime: 1_000, fundingRate: "0.00012345678901234567" },
        "BTCUSDT",
      ),
    ).toEqual({
      symbol: "BTCUSDT",
      fundingTimeMs: 1_000,
      fundingRate: "0.000123456789012346",
    });
    expect(
      parseRealizedFundingRate(
        { symbol: "BTCUSDT", fundingTime: 1_000, fundingRate: "1" },
        "BTCUSDT",
      ),
    ).toBeNull();
    expect(
      parseRealizedFundingRate(
        { symbol: "BTCUSDT", fundingTime: 1_000, fundingRate: "1e-4" },
        "BTCUSDT",
      ),
    ).toBeNull();
    expect(
      parseRealizedFundingRate(
        { symbol: "ETHUSDT", fundingTime: 1_000, fundingRate: "0.01" },
        "BTCUSDT",
      ),
    ).toBeNull();
  });

  it("fails closed on a non-array payload, malformed row, or mismatched symbol", () => {
    expect(() => parseRealizedFundingRates({}, "BTCUSDT")).toThrow(FundingSourceError);
    expect(() =>
      parseRealizedFundingRates(
        [{ symbol: "BTCUSDT", fundingTime: 1_000, fundingRate: "1e-4" }],
        "BTCUSDT",
      ),
    ).toThrow(FundingSourceError);
    expect(() =>
      parseRealizedFundingRates(
        [{ symbol: "ETHUSDT", fundingTime: 1_000, fundingRate: "0.01" }],
        "BTCUSDT",
      ),
    ).toThrow(FundingSourceError);
    expect(() =>
      parseRealizedFundingRates(
        [{ symbol: "BTCUSDT", fundingTime: "now", fundingRate: "0.01" }],
        "BTCUSDT",
      ),
    ).toThrow(FundingSourceError);
    expect(() => parseRealizedFundingRates([null], "BTCUSDT")).toThrow(FundingSourceError);
  });

  it("keeps a strictly valid page in source order", () => {
    const rows = parseRealizedFundingRates(
      [
        { symbol: "BTCUSDT", fundingTime: 4_000, fundingRate: "-0.02" },
        { symbol: "BTCUSDT", fundingTime: 8_000, fundingRate: "0.01" },
      ],
      "BTCUSDT",
    );
    expect(rows.map((row) => row.fundingTimeMs)).toEqual([4_000, 8_000]);
  });

  it("requires the exact expectedCloseTime 1m candle and rejects an older bar", () => {
    const times = [
      Date.parse("2026-09-15T10:00:00.000Z"),
      Date.parse("2026-09-15T10:00:00.001Z"),
      Date.parse("2026-09-15T10:00:30.000Z"),
      Date.parse("2026-09-15T10:00:59.999Z"),
    ];
    for (const fundingTimeMs of times) {
      expect(expectedMarkCandleCloseTimeMs(fundingTimeMs)).toBe(
        Date.parse("2026-09-15T09:59:59.999Z"),
      );
      expect(expectedMarkCandleOpenTimeMs(fundingTimeMs)).toBe(
        Date.parse("2026-09-15T09:59:00.000Z"),
      );
    }

    const exact = {
      openTime: Date.parse("2026-09-15T09:59:00.000Z"),
      closeTime: Date.parse("2026-09-15T09:59:59.999Z"),
      close: "100",
    };
    const older = {
      openTime: Date.parse("2026-09-15T09:58:00.000Z"),
      closeTime: Date.parse("2026-09-15T09:58:59.999Z"),
      close: "99",
    };
    expect(selectExactSettlementMark([older, exact], times[0] ?? 0)).toBe("100");
    expect(selectExactSettlementMark([older], times[0] ?? 0)).toBeNull();
  });

  it("rejects klines that are not 1m wide or that have a non-positive close", () => {
    expect(
      parseMarkPriceKlines([
        [
          Date.parse("2026-09-15T09:59:00.000Z"),
          "1",
          "1",
          "1",
          "100",
          "0",
          Date.parse("2026-09-15T10:00:59.999Z"),
        ],
      ]),
    ).toEqual([]);
    expect(
      parseMarkPriceKlines([
        [
          Date.parse("2026-09-15T09:59:00.000Z"),
          "1",
          "1",
          "1",
          "0",
          "0",
          Date.parse("2026-09-15T09:59:59.999Z"),
        ],
      ]),
    ).toEqual([]);
  });
});
