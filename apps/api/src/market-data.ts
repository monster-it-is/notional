import type {
  InstrumentNotFoundError,
  MarketDataResponse,
  MarketDataStatusResponse,
  MarketDataUnavailableError,
} from "@notional/contracts";
import { findInstrumentBySymbol, db } from "@notional/db";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { MarketDataAccess } from "./market-data/coordinator.js";

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
