import type { Candle } from "@notional/contracts";

import {
  parseNonNegativeDecimalString,
  parsePositiveDecimalString,
  parseSafeNonNegativeInteger,
} from "./decimal-string.js";

export class KlineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KlineParseError";
  }
}

export function parseKlines(payload: unknown): Candle[] {
  if (!Array.isArray(payload)) {
    throw new KlineParseError("klines payload must be an array");
  }

  const candles: Candle[] = [];

  for (const item of payload) {
    const candle = parseKline(item);

    if (!candle) {
      throw new KlineParseError("klines payload contains an invalid row");
    }

    candles.push(candle);
  }

  return candles;
}

export function parseKline(payload: unknown): Candle | null {
  if (!Array.isArray(payload) || payload.length < 7) {
    return null;
  }

  const openTime = parseSafeNonNegativeInteger(payload[0]);
  const open = parsePositiveDecimalString(payload[1]);
  const high = parsePositiveDecimalString(payload[2]);
  const low = parsePositiveDecimalString(payload[3]);
  const close = parsePositiveDecimalString(payload[4]);
  const volume = parseNonNegativeDecimalString(payload[5]);
  const closeTime = parseSafeNonNegativeInteger(payload[6]);

  if (
    openTime === null ||
    closeTime === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null
  ) {
    return null;
  }

  if (closeTime < openTime) {
    return null;
  }

  return {
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    volume,
  };
}
