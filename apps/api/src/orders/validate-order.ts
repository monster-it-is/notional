import type { PositionTransition } from "@notional/trading";
import {
  parsePositiveDecimalString,
  toCanonicalDecimalString,
  validateMinNotional,
  validatePriceFilter,
  validateQuantityFilter,
} from "@notional/trading";

export type OrderValidationReason = "INVALID_QUANTITY" | "INVALID_PRICE" | "MIN_NOTIONAL";

export type OrderValidationCode =
  | "ACCOUNT_NOT_INITIALIZED"
  | "ACCOUNT_SUSPENDED"
  | "INSTRUMENT_NOT_FOUND"
  | "INSTRUMENT_INACTIVE"
  | "MARKET_DATA_UNAVAILABLE"
  | "INVALID_ORDER";

export class OrderValidationError extends Error {
  readonly code: OrderValidationCode;
  readonly reason?: OrderValidationReason;

  constructor(code: OrderValidationCode, reason?: OrderValidationReason, cause?: unknown) {
    super(reason ? `${code}:${reason}` : code);
    this.name = "OrderValidationError";
    this.code = code;
    this.reason = reason;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export type OrderFilterInstrument = {
  status: string;
  tickSize: string;
  minPrice: string;
  maxPrice: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  marketStepSize: string;
  marketMinQty: string;
  marketMaxQty: string;
  minNotional: string;
};

export type FreshBookQuote = {
  bestBidPrice: string;
  bestAskPrice: string;
};

export type LimitOrderRequest = {
  type: "LIMIT";
  side: "BUY" | "SELL";
  quantity: string;
  limitPrice: string;
  reduceOnly?: boolean;
};

export type MarketOrderRequest = {
  type: "MARKET";
  side: "BUY" | "SELL";
  quantity: string;
  reduceOnly?: boolean;
};

export type ValidatedOrder = {
  quantity: string;
  limitPrice: string | null;
  reduceOnly: boolean;
};

export function reduceOnlyAllows(transition: PositionTransition): boolean {
  return transition === "REDUCE" || transition === "CLOSE";
}

export function assertOrderPlacementEligibility(params: {
  account: { status: string } | null;
  initialized: boolean;
  instrument: { status: string } | null;
}): void {
  if (!params.initialized || params.account === null) {
    throw new OrderValidationError("ACCOUNT_NOT_INITIALIZED");
  }

  if (params.account.status === "SUSPENDED") {
    throw new OrderValidationError("ACCOUNT_SUSPENDED");
  }

  if (params.instrument === null) {
    throw new OrderValidationError("INSTRUMENT_NOT_FOUND");
  }

  if (params.instrument.status !== "ACTIVE") {
    throw new OrderValidationError("INSTRUMENT_INACTIVE");
  }
}

export function validateLimitOrderFilters(params: {
  quantity: string;
  limitPrice: string;
  instrument: OrderFilterInstrument;
}): { quantity: string; limitPrice: string } {
  const quantity = canonicalQuantity(params.quantity, params.instrument, "LOT_SIZE");
  const limitPrice = canonicalLimitPrice(params.limitPrice, params.instrument);

  try {
    validateMinNotional({
      quantity,
      price: limitPrice,
      minNotional: params.instrument.minNotional,
    });
  } catch (error) {
    throw mapInvalidOrder(error, "MIN_NOTIONAL");
  }

  return { quantity, limitPrice };
}

export function validateMarketOrderFilters(params: {
  side: "BUY" | "SELL";
  quantity: string;
  instrument: OrderFilterInstrument;
  markPrice: string | null;
  book: FreshBookQuote | null;
}): { quantity: string } {
  const quantity = canonicalQuantity(params.quantity, params.instrument, "MARKET_LOT_SIZE");

  if (params.markPrice === null) {
    throw new OrderValidationError("MARKET_DATA_UNAVAILABLE");
  }

  let markPrice: string;

  try {
    markPrice = parsePositiveDecimalString(params.markPrice);
  } catch (error) {
    throw new OrderValidationError("MARKET_DATA_UNAVAILABLE", undefined, error);
  }

  try {
    validateMinNotional({
      quantity,
      price: markPrice,
      minNotional: params.instrument.minNotional,
    });
  } catch (error) {
    throw mapInvalidOrder(error, "MIN_NOTIONAL");
  }

  if (params.book === null) {
    throw new OrderValidationError("MARKET_DATA_UNAVAILABLE");
  }

  const executablePrice =
    params.side === "BUY" ? params.book.bestAskPrice : params.book.bestBidPrice;

  try {
    parsePositiveDecimalString(executablePrice);
  } catch (error) {
    throw new OrderValidationError("MARKET_DATA_UNAVAILABLE", undefined, error);
  }

  return { quantity };
}

export function validateOrderPlacement(params: {
  request: LimitOrderRequest | MarketOrderRequest;
  account: { status: string } | null;
  initialized: boolean;
  instrument: OrderFilterInstrument | null;
  markPrice: string | null;
  book: FreshBookQuote | null;
}): ValidatedOrder {
  assertOrderPlacementEligibility({
    account: params.account,
    initialized: params.initialized,
    instrument: params.instrument,
  });

  if (params.instrument === null) {
    throw new OrderValidationError("INSTRUMENT_NOT_FOUND");
  }

  const reduceOnly = params.request.reduceOnly ?? false;

  if (params.request.type === "LIMIT") {
    const validated = validateLimitOrderFilters({
      quantity: params.request.quantity,
      limitPrice: params.request.limitPrice,
      instrument: params.instrument,
    });

    return {
      quantity: validated.quantity,
      limitPrice: validated.limitPrice,
      reduceOnly,
    };
  }

  const validated = validateMarketOrderFilters({
    side: params.request.side,
    quantity: params.request.quantity,
    instrument: params.instrument,
    markPrice: params.markPrice,
    book: params.book,
  });

  return {
    quantity: validated.quantity,
    limitPrice: null,
    reduceOnly,
  };
}

function canonicalQuantity(
  quantity: string,
  instrument: OrderFilterInstrument,
  lot: "LOT_SIZE" | "MARKET_LOT_SIZE",
): string {
  try {
    const canonical = parsePositiveDecimalString(quantity);
    validateQuantityFilter(
      lot === "LOT_SIZE"
        ? {
            quantity: canonical,
            minQty: instrument.minQty,
            maxQty: instrument.maxQty,
            stepSize: instrument.stepSize,
          }
        : {
            quantity: canonical,
            minQty: instrument.marketMinQty,
            maxQty: instrument.marketMaxQty,
            stepSize: instrument.marketStepSize,
          },
    );
    return toCanonicalDecimalString(canonical);
  } catch (error) {
    throw mapInvalidOrder(error, "INVALID_QUANTITY");
  }
}

function canonicalLimitPrice(limitPrice: string, instrument: OrderFilterInstrument): string {
  try {
    const canonical = parsePositiveDecimalString(limitPrice);
    validatePriceFilter({
      price: canonical,
      tickSize: instrument.tickSize,
      minPrice: instrument.minPrice,
      maxPrice: instrument.maxPrice,
    });
    return toCanonicalDecimalString(canonical);
  } catch (error) {
    throw mapInvalidOrder(error, "INVALID_PRICE");
  }
}

function mapInvalidOrder(error: unknown, reason: OrderValidationReason): OrderValidationError {
  if (error instanceof OrderValidationError) {
    return error;
  }

  return new OrderValidationError("INVALID_ORDER", reason, error);
}
