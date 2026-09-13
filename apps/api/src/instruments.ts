import type {
  InstrumentContractType,
  InstrumentListResponse,
  InstrumentNotFoundError,
  InstrumentQuoteAsset,
  InstrumentResponse,
  InstrumentStatus,
} from "@notional/contracts";
import {
  db,
  findInstrumentBySymbol,
  listActiveInstruments,
  type Instrument,
} from "@notional/db";
import type { FastifyReply, FastifyRequest } from "fastify";

export async function getInstruments(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<InstrumentListResponse | { error: string }> {
  if (!request.auth) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const rows = await listActiveInstruments(db);

  return {
    instruments: rows.map(toInstrumentResponse),
  };
}

export async function getInstrumentBySymbol(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<InstrumentResponse | InstrumentNotFoundError | { error: string }> {
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

  return toInstrumentResponse(instrument);
}

function toInstrumentResponse(row: Instrument): InstrumentResponse {
  assertDecimalString(row.tickSize, "tickSize");
  assertDecimalString(row.minPrice, "minPrice");
  assertDecimalString(row.maxPrice, "maxPrice");
  assertDecimalString(row.stepSize, "stepSize");
  assertDecimalString(row.minQty, "minQty");
  assertDecimalString(row.maxQty, "maxQty");
  assertDecimalString(row.marketStepSize, "marketStepSize");
  assertDecimalString(row.marketMinQty, "marketMinQty");
  assertDecimalString(row.marketMaxQty, "marketMaxQty");
  assertDecimalString(row.minNotional, "minNotional");

  return {
    id: row.id,
    symbol: row.symbol,
    baseAsset: row.baseAsset,
    quoteAsset: asQuoteAsset(row.quoteAsset),
    contractType: asContractType(row.contractType),
    status: asInstrumentStatus(row.status),
    tickSize: row.tickSize,
    minPrice: row.minPrice,
    maxPrice: row.maxPrice,
    stepSize: row.stepSize,
    minQty: row.minQty,
    maxQty: row.maxQty,
    marketStepSize: row.marketStepSize,
    marketMinQty: row.marketMinQty,
    marketMaxQty: row.marketMaxQty,
    minNotional: row.minNotional,
  };
}

function asQuoteAsset(value: string): InstrumentQuoteAsset {
  if (value === "USDT") {
    return value;
  }

  throw new Error(`invalid instrument.quote_asset: ${value}`);
}

function asContractType(value: string): InstrumentContractType {
  if (value === "PERPETUAL") {
    return value;
  }

  throw new Error(`invalid instrument.contract_type: ${value}`);
}

function asInstrumentStatus(value: string): InstrumentStatus {
  if (value === "ACTIVE" || value === "INACTIVE") {
    return value;
  }

  throw new Error(`invalid instrument.status: ${value}`);
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

function assertDecimalString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`instrument.${field} must be a string`);
  }
}
