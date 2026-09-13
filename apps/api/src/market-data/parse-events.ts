import {
  parseFiniteDecimalString,
  parsePositiveDecimalString,
  parseSafeNonNegativeInteger,
} from "./decimal-string.js";
import type { BookTick, MarkTick } from "./types.js";

const COIN_M_SYMBOL_TYPE = 2;

export function parseJsonPayload(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function unwrapStreamPayload(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return payload;
  }

  if ("stream" in payload && "data" in payload) {
    return payload.data;
  }

  return payload;
}

export function parseMarkTicks(payload: unknown): MarkTick[] {
  const unwrapped = unwrapStreamPayload(payload);

  if (Array.isArray(unwrapped)) {
    return unwrapped.flatMap((item) => {
      const tick = parseMarkTick(item);
      return tick ? [tick] : [];
    });
  }

  const tick = parseMarkTick(unwrapped);
  return tick ? [tick] : [];
}

export function parseBookTick(payload: unknown): BookTick | null {
  const unwrapped = unwrapStreamPayload(payload);
  return parseBookTickObject(unwrapped);
}

export function parsePremiumIndexTicks(payload: unknown): MarkTick[] {
  const rows = asObjectArray(payload);
  return rows.flatMap((row) => {
    const tick = parseRestMarkTick(row);
    return tick ? [tick] : [];
  });
}

export function parseBookTickerTicks(payload: unknown): BookTick[] {
  const rows = asObjectArray(payload);
  return rows.flatMap((row) => {
    const tick = parseRestBookTick(row);
    return tick ? [tick] : [];
  });
}

function asObjectArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  return isRecord(payload) ? [payload] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoinMargined(value: Record<string, unknown>): boolean {
  return value.st === COIN_M_SYMBOL_TYPE;
}

function parseMarkTick(value: unknown): MarkTick | null {
  if (!isRecord(value) || isCoinMargined(value)) {
    return null;
  }

  if (typeof value.s !== "string" || value.s === "") {
    return null;
  }

  const markPrice = parsePositiveDecimalString(value.p);
  const indexPrice = parsePositiveDecimalString(value.i);
  const fundingRate = parseFiniteDecimalString(value.r);
  const nextFundingTime = parseSafeNonNegativeInteger(value.T);
  const markEventTime = parseSafeNonNegativeInteger(value.E);

  if (
    markPrice === null ||
    indexPrice === null ||
    fundingRate === null ||
    nextFundingTime === null ||
    markEventTime === null
  ) {
    return null;
  }

  return {
    symbol: value.s,
    markPrice,
    indexPrice,
    fundingRate,
    nextFundingTime,
    markEventTime,
  };
}

function parseBookTickObject(value: unknown): BookTick | null {
  if (!isRecord(value) || isCoinMargined(value)) {
    return null;
  }

  if (typeof value.s !== "string" || value.s === "") {
    return null;
  }

  const bestBidPrice = parsePositiveDecimalString(value.b);
  const bestBidQty = parsePositiveDecimalString(value.B);
  const bestAskPrice = parsePositiveDecimalString(value.a);
  const bestAskQty = parsePositiveDecimalString(value.A);
  const bookUpdateId = parseSafeNonNegativeInteger(value.u);
  const bookEventTime =
    parseSafeNonNegativeInteger(value.E) ?? parseSafeNonNegativeInteger(value.T) ?? 0;

  if (
    bestBidPrice === null ||
    bestBidQty === null ||
    bestAskPrice === null ||
    bestAskQty === null ||
    bookUpdateId === null
  ) {
    return null;
  }

  return {
    symbol: value.s,
    bestBidPrice,
    bestBidQty,
    bestAskPrice,
    bestAskQty,
    bookUpdateId,
    bookEventTime,
  };
}

function parseRestMarkTick(value: Record<string, unknown>): MarkTick | null {
  if (typeof value.symbol !== "string" || value.symbol === "") {
    return null;
  }

  const markPrice = parsePositiveDecimalString(value.markPrice);
  const indexPrice = parsePositiveDecimalString(value.indexPrice);
  const fundingRate = parseFiniteDecimalString(value.lastFundingRate);
  const nextFundingTime = parseSafeNonNegativeInteger(value.nextFundingTime);
  const markEventTime = parseSafeNonNegativeInteger(value.time);

  if (
    markPrice === null ||
    indexPrice === null ||
    fundingRate === null ||
    nextFundingTime === null ||
    markEventTime === null
  ) {
    return null;
  }

  return {
    symbol: value.symbol,
    markPrice,
    indexPrice,
    fundingRate,
    nextFundingTime,
    markEventTime,
  };
}

function parseRestBookTick(value: Record<string, unknown>): BookTick | null {
  if (typeof value.symbol !== "string" || value.symbol === "") {
    return null;
  }

  const bestBidPrice = parsePositiveDecimalString(value.bidPrice);
  const bestBidQty = parsePositiveDecimalString(value.bidQty);
  const bestAskPrice = parsePositiveDecimalString(value.askPrice);
  const bestAskQty = parsePositiveDecimalString(value.askQty);
  const bookUpdateId = parseSafeNonNegativeInteger(value.lastUpdateId);
  const bookEventTime = parseSafeNonNegativeInteger(value.time) ?? 0;

  if (
    bestBidPrice === null ||
    bestBidQty === null ||
    bestAskPrice === null ||
    bestAskQty === null ||
    bookUpdateId === null
  ) {
    return null;
  }

  return {
    symbol: value.symbol,
    bestBidPrice,
    bestBidQty,
    bestAskPrice,
    bestAskQty,
    bookUpdateId,
    bookEventTime,
  };
}
