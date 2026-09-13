import type { UpsertInstrumentInput } from "@notional/db";
import { MoneyDecimal } from "@notional/db";
import { z } from "zod";

import {
  parseNonNegativeDecimalString,
  parsePositiveDecimalString,
} from "./decimal-string.js";

const exchangeInfoSchema = z
  .object({
    symbols: z.array(z.unknown()),
  })
  .passthrough();

const candidateSchema = z
  .object({
    symbol: z.string().min(1),
    baseAsset: z.string().min(1),
    quoteAsset: z.string(),
    marginAsset: z.string(),
    contractType: z.string(),
    underlyingType: z.string(),
    status: z.string(),
    filters: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type MapExchangeInfoResult =
  | { ok: true; instruments: UpsertInstrumentInput[] }
  | {
      ok: false;
      reason: "invalid_snapshot" | "malformed_candidate" | "empty";
      detail: string;
    };

export function mapExchangeInfo(payload: unknown): MapExchangeInfoResult {
  const snapshot = exchangeInfoSchema.safeParse(payload);

  if (!snapshot.success) {
    return {
      ok: false,
      reason: "invalid_snapshot",
      detail: "exchangeInfo is missing a symbols array",
    };
  }

  const instruments: UpsertInstrumentInput[] = [];
  const seen = new Set<string>();

  for (const raw of snapshot.data.symbols) {
    const candidate = candidateSchema.safeParse(raw);

    if (!candidate.success || !isEligible(candidate.data)) {
      continue;
    }

    const mapped = mapEligibleCandidate(candidate.data);

    if (!mapped.ok) {
      return mapped;
    }

    if (seen.has(mapped.instrument.symbol)) {
      return {
        ok: false,
        reason: "malformed_candidate",
        detail: `duplicate eligible symbol ${mapped.instrument.symbol}`,
      };
    }

    seen.add(mapped.instrument.symbol);
    instruments.push(mapped.instrument);
  }

  if (instruments.length === 0) {
    return {
      ok: false,
      reason: "empty",
      detail: "exchangeInfo contained no eligible COIN USDT perpetuals",
    };
  }

  return { ok: true, instruments };
}

function isEligible(candidate: z.infer<typeof candidateSchema>): boolean {
  return (
    candidate.contractType === "PERPETUAL" &&
    candidate.quoteAsset === "USDT" &&
    candidate.marginAsset === "USDT" &&
    candidate.underlyingType === "COIN"
  );
}

function mapEligibleCandidate(
  candidate: z.infer<typeof candidateSchema>,
):
  | { ok: true; instrument: UpsertInstrumentInput }
  | { ok: false; reason: "malformed_candidate"; detail: string } {
  if (candidate.symbol !== candidate.symbol.toUpperCase()) {
    return {
      ok: false,
      reason: "malformed_candidate",
      detail: `eligible symbol ${candidate.symbol} is not uppercase`,
    };
  }

  const filters = candidate.filters ?? [];
  const price = requiredFilter(filters, "PRICE_FILTER", candidate.symbol);
  const lot = requiredFilter(filters, "LOT_SIZE", candidate.symbol);
  const marketLot = requiredFilter(filters, "MARKET_LOT_SIZE", candidate.symbol);
  const minNotional = requiredFilter(filters, "MIN_NOTIONAL", candidate.symbol);

  if (!price.ok) {
    return price;
  }
  if (!lot.ok) {
    return lot;
  }
  if (!marketLot.ok) {
    return marketLot;
  }
  if (!minNotional.ok) {
    return minNotional;
  }

  const tickSize = parseNonNegativeDecimalString(price.filter.tickSize);
  const minPrice = parseNonNegativeDecimalString(price.filter.minPrice);
  const maxPrice = parseNonNegativeDecimalString(price.filter.maxPrice);
  const stepSize = parsePositiveDecimalString(lot.filter.stepSize);
  const minQty = parsePositiveDecimalString(lot.filter.minQty);
  const maxQty = parsePositiveDecimalString(lot.filter.maxQty);
  const marketStepSize = parsePositiveDecimalString(marketLot.filter.stepSize);
  const marketMinQty = parsePositiveDecimalString(marketLot.filter.minQty);
  const marketMaxQty = parsePositiveDecimalString(marketLot.filter.maxQty);
  const notional = parsePositiveDecimalString(minNotional.filter.notional);

  if (
    tickSize === null ||
    minPrice === null ||
    maxPrice === null ||
    stepSize === null ||
    minQty === null ||
    maxQty === null ||
    marketStepSize === null ||
    marketMinQty === null ||
    marketMaxQty === null ||
    notional === null
  ) {
    return {
      ok: false,
      reason: "malformed_candidate",
      detail: `eligible symbol ${candidate.symbol} has malformed required filter decimals`,
    };
  }

  if (new MoneyDecimal(maxQty).lt(minQty) || new MoneyDecimal(marketMaxQty).lt(marketMinQty)) {
    return {
      ok: false,
      reason: "malformed_candidate",
      detail: `eligible symbol ${candidate.symbol} has an inverted quantity range`,
    };
  }

  return {
    ok: true,
    instrument: {
      symbol: candidate.symbol,
      baseAsset: candidate.baseAsset,
      status: candidate.status === "TRADING" ? "ACTIVE" : "INACTIVE",
      tickSize,
      minPrice,
      maxPrice,
      stepSize,
      minQty,
      maxQty,
      marketStepSize,
      marketMinQty,
      marketMaxQty,
      minNotional: notional,
    },
  };
}

function requiredFilter(
  filters: unknown[],
  filterType: string,
  symbol: string,
):
  | { ok: true; filter: Record<string, unknown> }
  | { ok: false; reason: "malformed_candidate"; detail: string } {
  const matches = filters.filter((filter): filter is Record<string, unknown> => {
    return (
      typeof filter === "object" &&
      filter !== null &&
      "filterType" in filter &&
      filter.filterType === filterType
    );
  });

  if (matches.length !== 1) {
    return {
      ok: false,
      reason: "malformed_candidate",
      detail: `eligible symbol ${symbol} is missing a valid ${filterType}`,
    };
  }

  return { ok: true, filter: matches[0]! };
}
