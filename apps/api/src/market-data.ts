import type {
  CandleInterval,
  CandleListResponse,
  InstrumentNotFoundError,
  InvalidQueryError,
  MarketDataResponse,
  MarketDataStatusResponse,
  MarketDataUnavailableError,
} from "@notional/contracts";
import { CANDLE_INTERVALS } from "@notional/contracts";
import { findInstrumentBySymbol, db } from "@notional/db";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { MarketDataAccess } from "./market-data/coordinator.js";
import { parseKlines } from "./market-data/parse-klines.js";

const DEFAULT_CANDLE_INTERVAL: CandleInterval = "15m";
const DEFAULT_CANDLE_LIMIT = 500;
const MIN_CANDLE_LIMIT = 1;
const MAX_CANDLE_LIMIT = 1500;

export type GetKlines = (query: {
  symbol: string;
  interval: CandleInterval;
  limit: number;
  endTime?: number;
}) => Promise<unknown>;

export async function getMarketDataBySymbol(
  request: FastifyRequest,
  reply: FastifyReply,
  marketData: MarketDataAccess,
): Promise<MarketDataResponse | InstrumentNotFoundError | MarketDataUnavailableError | { error: string }> {
  if (!request.auth) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const symbol = requestSymbol(request);

  if (!symbol) {
    return reply.status(404).send({ error: "INSTRUMENT_NOT_FOUND" });
  }

  const instrument = await findInstrumentBySymbol(db, symbol);

  if (!instrument) {
    return reply.status(404).send({ error: "INSTRUMENT_NOT_FOUND" });
  }

  const snapshot = marketData.getReadySnapshot(instrument.symbol);

  if (!snapshot) {
    return reply.status(503).send({ error: "MARKET_DATA_UNAVAILABLE" });
  }

  return snapshot;
}

export async function getMarketDataStatus(
  request: FastifyRequest,
  reply: FastifyReply,
  marketData: MarketDataAccess,
): Promise<MarketDataStatusResponse | { error: string }> {
  if (!request.auth) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  return marketData.getStatus();
}

export async function getMarketDataCandles(
  request: FastifyRequest,
  reply: FastifyReply,
  getKlines: GetKlines,
): Promise<
  CandleListResponse | InstrumentNotFoundError | InvalidQueryError | MarketDataUnavailableError | { error: string }
> {
  if (!request.auth) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const symbol = requestSymbol(request);

  if (!symbol) {
    return reply.status(404).send({ error: "INSTRUMENT_NOT_FOUND" });
  }

  const instrument = await findInstrumentBySymbol(db, symbol);

  if (!instrument) {
    return reply.status(404).send({ error: "INSTRUMENT_NOT_FOUND" });
  }

  const query = parseCandleQuery(request.query);

  if (query === "invalid_query") {
    return reply.status(400).send({ error: "INVALID_QUERY" });
  }

  try {
    const payload = await getKlines(
      query.before === undefined
        ? {
            symbol: instrument.symbol,
            interval: query.interval,
            limit: query.limit,
          }
        : {
            symbol: instrument.symbol,
            interval: query.interval,
            limit: query.limit,
            endTime: query.before - 1,
          },
    );

    const candles = parseKlines(payload);
    const before = query.before;

    if (before !== undefined && candles.some((candle) => candle.openTime >= before)) {
      return reply.status(503).send({ error: "MARKET_DATA_UNAVAILABLE" });
    }

    return {
      symbol: instrument.symbol,
      interval: query.interval,
      candles,
    };
  } catch {
    return reply.status(503).send({ error: "MARKET_DATA_UNAVAILABLE" });
  }
}

type CandleQuery = {
  interval: CandleInterval;
  limit: number;
  before?: number;
};

function parseCandleQuery(query: unknown): CandleQuery | "invalid_query" {
  if (query === undefined || query === null || typeof query !== "object") {
    return { interval: DEFAULT_CANDLE_INTERVAL, limit: DEFAULT_CANDLE_LIMIT };
  }

  const record = query as Record<string, unknown>;
  const interval = parseCandleInterval(record.interval);
  const limit = parseCandleLimit(record.limit);
  const before = parseCandleBefore(record.before);

  if (interval === null || limit === null || before === null) {
    return "invalid_query";
  }

  return before === undefined ? { interval, limit } : { interval, limit, before };
}

function parseCandleInterval(value: unknown): CandleInterval | null {
  if (value === undefined) {
    return DEFAULT_CANDLE_INTERVAL;
  }

  if (typeof value !== "string") {
    return null;
  }

  return isCandleInterval(value) ? value : null;
}

function parseCandleLimit(value: unknown): number | null {
  if (value === undefined) {
    return DEFAULT_CANDLE_LIMIT;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const text = String(value);

  if (!/^\d+$/.test(text)) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);

  if (!Number.isSafeInteger(parsed) || parsed < MIN_CANDLE_LIMIT || parsed > MAX_CANDLE_LIMIT) {
    return null;
  }

  return parsed;
}

function parseCandleBefore(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const text = String(value);

  if (!/^\d+$/.test(text)) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function isCandleInterval(value: string): value is CandleInterval {
  return (CANDLE_INTERVALS as readonly string[]).includes(value);
}

function requestSymbol(request: FastifyRequest): string | null {
  const params = request.params;

  if (params === undefined || params === null || typeof params !== "object") {
    return null;
  }

  if (!("symbol" in params) || typeof params.symbol !== "string" || params.symbol === "") {
    return null;
  }

  return params.symbol;
}
