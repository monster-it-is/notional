import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseKline, parseKlines, KlineParseError } from "./parse-klines.js";

const BINANCE_ROW = [
  1_499_040_000_000,
  "0.01634790",
  "0.80000000",
  "0.01575800",
  "0.01577100",
  "148976.11427815",
  1_499_644_799_999,
  "2434.19055334",
  308,
  "1756.87402397",
  "28.46694368",
  "0",
] as const;

describe("parseKline", () => {
  it("maps the seven required Binance kline fields and ignores the rest", () => {
    expect(parseKline([...BINANCE_ROW])).toEqual({
      openTime: 1_499_040_000_000,
      closeTime: 1_499_644_799_999,
      open: "0.01634790",
      high: "0.80000000",
      low: "0.01575800",
      close: "0.01577100",
      volume: "148976.11427815",
    });
  });

  it("keeps OHLCV as the original decimal strings", () => {
    const candle = parseKline([...BINANCE_ROW]);

    expect(typeof candle?.open).toBe("string");
    expect(typeof candle?.high).toBe("string");
    expect(typeof candle?.low).toBe("string");
    expect(typeof candle?.close).toBe("string");
    expect(typeof candle?.volume).toBe("string");
    expect(candle?.open).toBe("0.01634790");
    expect(candle?.volume).toBe("148976.11427815");
  });

  it("accepts zero volume", () => {
    const row = [...BINANCE_ROW];
    row[5] = "0";
    expect(parseKline(row)?.volume).toBe("0");
  });

  it("rejects a short row", () => {
    expect(parseKline(BINANCE_ROW.slice(0, 6))).toBeNull();
  });

  it("rejects invalid timestamps", () => {
    const fractional = [...BINANCE_ROW];
    fractional[0] = 1.5;
    expect(parseKline(fractional)).toBeNull();

    const unsafe = [...BINANCE_ROW];
    unsafe[6] = Number.MAX_SAFE_INTEGER + 1;
    expect(parseKline(unsafe)).toBeNull();

    const asString = [...BINANCE_ROW];
    asString[0] = "1499040000000";
    expect(parseKline(asString)).toBeNull();
  });

  it("rejects closeTime before openTime", () => {
    const row = [...BINANCE_ROW];
    row[6] = 1_499_039_999_999;
    expect(parseKline(row)).toBeNull();
  });

  it("rejects invalid, zero, and negative OHLC decimals", () => {
    expect(parseKline(withField(1, "not-a-number"))).toBeNull();
    expect(parseKline(withField(2, "0"))).toBeNull();
    expect(parseKline(withField(3, "-0.1"))).toBeNull();
    expect(parseKline(withField(4, 0.015771))).toBeNull();
  });

  it("rejects negative and invalid volume", () => {
    expect(parseKline(withField(5, "-1"))).toBeNull();
    expect(parseKline(withField(5, "n/a"))).toBeNull();
    expect(parseKline(withField(5, 0))).toBeNull();
  });
});

describe("parseKlines", () => {
  it("preserves upstream order for multiple rows", () => {
    const later = [...BINANCE_ROW];
    later[0] = 1_499_644_800_000;
    later[6] = 1_500_249_599_999;
    later[4] = "0.01600000";

    expect(parseKlines([[...BINANCE_ROW], later]).map((row) => row.openTime)).toEqual([
      1_499_040_000_000,
      1_499_644_800_000,
    ]);
  });

  it("rejects a non-array payload", () => {
    expect(() => parseKlines({})).toThrow(KlineParseError);
    expect(() => parseKlines(null)).toThrow(KlineParseError);
  });

  it("rejects a payload that contains any malformed row", () => {
    expect(() => parseKlines([[...BINANCE_ROW], withField(4, "0")])).toThrow(KlineParseError);
  });

  it("does not convert OHLCV with Number or parseFloat", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "parse-klines.ts"), "utf8");
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bNumber\s*\(/);
  });
});

function withField(index: number, value: unknown): unknown[] {
  const row = [...BINANCE_ROW];
  row[index] = value;
  return row;
}
