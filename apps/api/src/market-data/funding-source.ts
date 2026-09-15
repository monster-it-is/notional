import {
  persistFundingMarkToNumeric3818,
  persistFundingRateToNumeric3818,
  expectedMarkCandleCloseTimeMs,
} from "@notional/trading";

import {
  parseFiniteDecimalString,
  parsePositiveDecimalString,
  parseSafeNonNegativeInteger,
} from "./decimal-string.js";

export type RealizedFundingRate = {
  symbol: string;
  fundingTimeMs: number;
  fundingRate: string;
};

export type SettlementMarkCandle = {
  openTime: number;
  closeTime: number;
  close: string;
};

export class FundingSourceError extends Error {
  readonly code = "FUNDING_SOURCE_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "FundingSourceError";
  }
}

const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function expectedMarkCandleOpenTimeMs(fundingTimeMs: number): number {
  return expectedMarkCandleCloseTimeMs(fundingTimeMs) - 59_999;
}

export function parseRealizedFundingRates(
  payload: unknown,
  symbol: string,
): RealizedFundingRate[] {
  if (!Array.isArray(payload)) {
    throw new FundingSourceError("fundingRate payload must be an array");
  }

  const rows: RealizedFundingRate[] = [];

  for (const item of payload) {
    const parsed = parseRealizedFundingRate(item, symbol);
    if (!parsed) {
      throw new FundingSourceError("fundingRate page contains an invalid row");
    }
    rows.push(parsed);
  }

  return rows;
}

export function parseRealizedFundingRate(
  payload: unknown,
  symbol: string,
): RealizedFundingRate | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (payload.symbol !== symbol) {
    return null;
  }

  const fundingTimeMs = parseSafeNonNegativeInteger(payload.fundingTime);
  const rawRate = parseFiniteDecimalString(payload.fundingRate);

  if (fundingTimeMs === null || rawRate === null || !PLAIN_DECIMAL.test(rawRate)) {
    return null;
  }

  try {
    return {
      symbol,
      fundingTimeMs,
      fundingRate: persistFundingRateToNumeric3818(rawRate),
    };
  } catch {
    return null;
  }
}

export function parseMarkPriceKlines(payload: unknown): SettlementMarkCandle[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((item) => {
    const candle = parseMarkPriceKline(item);
    return candle ? [candle] : [];
  });
}

export function parseMarkPriceKline(payload: unknown): SettlementMarkCandle | null {
  if (!Array.isArray(payload) || payload.length < 7) {
    return null;
  }

  const openTime = parseSafeNonNegativeInteger(payload[0]);
  const close = parsePositiveDecimalString(payload[4]);
  const closeTime = parseSafeNonNegativeInteger(payload[6]);

  if (openTime === null || close === null || closeTime === null || !PLAIN_DECIMAL.test(close)) {
    return null;
  }

  if (closeTime - openTime + 1 !== 60_000) {
    return null;
  }

  try {
    return {
      openTime,
      closeTime,
      close: persistFundingMarkToNumeric3818(close),
    };
  } catch {
    return null;
  }
}

export function selectExactSettlementMark(
  candles: SettlementMarkCandle[],
  fundingTimeMs: number,
): string | null {
  const expectedCloseTime = expectedMarkCandleCloseTimeMs(fundingTimeMs);
  const match = candles.find((candle) => candle.closeTime === expectedCloseTime);

  return match?.close ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
