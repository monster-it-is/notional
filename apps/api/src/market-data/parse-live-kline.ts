import { CANDLE_INTERVALS, type CandleInterval } from "@notional/contracts";

import {
  parseNonNegativeDecimalString,
  parsePositiveDecimalString,
  parseSafeNonNegativeInteger,
} from "./decimal-string.js";
import { unwrapStreamPayload } from "./parse-events.js";

const CANONICAL_SYMBOL = /^[A-Z0-9]+$/;
const INTERVALS = new Set<string>(CANDLE_INTERVALS);

export type LiveKline = {
  symbol: string;
  interval: CandleInterval;
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  isClosed: boolean;
};

export function parseLiveKline(payload: unknown): LiveKline | null {
  const unwrapped = unwrapStreamPayload(payload);

  if (!isRecord(unwrapped) || unwrapped.e !== "kline") {
    return null;
  }

  if (!isRecord(unwrapped.k)) {
    return null;
  }

  const kline = unwrapped.k;
  const symbol = parseCanonicalSymbol(kline.s ?? unwrapped.s);
  const interval = parseCandleInterval(kline.i);
  const openTime = parseSafeNonNegativeInteger(kline.t);
  const closeTime = parseSafeNonNegativeInteger(kline.T);
  const open = parsePositiveDecimalString(kline.o);
  const high = parsePositiveDecimalString(kline.h);
  const low = parsePositiveDecimalString(kline.l);
  const close = parsePositiveDecimalString(kline.c);
  const volume = parseNonNegativeDecimalString(kline.v);

  if (
    symbol === null ||
    interval === null ||
    openTime === null ||
    closeTime === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    typeof kline.x !== "boolean"
  ) {
    return null;
  }

  if (closeTime < openTime) {
    return null;
  }

  return {
    symbol,
    interval,
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    volume,
    isClosed: kline.x,
  };
}

function parseCanonicalSymbol(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const symbol = value.trim().toUpperCase();
  return CANONICAL_SYMBOL.test(symbol) ? symbol : null;
}

function parseCandleInterval(value: unknown): CandleInterval | null {
  return typeof value === "string" && INTERVALS.has(value) ? (value as CandleInterval) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
