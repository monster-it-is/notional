import {
  parseCommittedDecimal,
  parseCommittedNonNegative,
  parseCommittedPositive,
} from "./decimal.js";
import type { TradingDecimal } from "./decimal.js";
import { TradingMathError } from "./errors.js";
import { calculateNotional } from "./notional.js";

function isOnGrid(
  value: TradingDecimal,
  origin: TradingDecimal,
  step: TradingDecimal,
): boolean {
  return value.minus(origin).mod(step).isZero();
}

export function isTickAligned(params: {
  price: string;
  tickSize: string;
  minPrice: string;
}): boolean {
  const price = parseCommittedPositive(params.price, "price");
  const tickSize = parseCommittedNonNegative(params.tickSize, "tickSize");
  const minPrice = parseCommittedNonNegative(params.minPrice, "minPrice");

  if (tickSize.isZero()) {
    return true;
  }

  return isOnGrid(price, minPrice, tickSize);
}

export function isPriceInRange(params: {
  price: string;
  minPrice: string;
  maxPrice: string;
}): boolean {
  const price = parseCommittedPositive(params.price, "price");
  const minPrice = parseCommittedNonNegative(params.minPrice, "minPrice");
  const maxPrice = parseCommittedNonNegative(params.maxPrice, "maxPrice");

  if (!minPrice.isZero() && !maxPrice.isZero() && maxPrice.lt(minPrice)) {
    throw new TradingMathError("INVALID_ARGUMENT", "maxPrice is less than minPrice");
  }

  if (!minPrice.isZero() && price.lt(minPrice)) {
    return false;
  }

  if (!maxPrice.isZero() && price.gt(maxPrice)) {
    return false;
  }

  return true;
}

export function validatePriceFilter(params: {
  price: string;
  tickSize: string;
  minPrice: string;
  maxPrice: string;
}): void {
  const price = parseCommittedPositive(params.price, "price");
  const tickSize = parseCommittedNonNegative(params.tickSize, "tickSize");
  const minPrice = parseCommittedNonNegative(params.minPrice, "minPrice");
  const maxPrice = parseCommittedNonNegative(params.maxPrice, "maxPrice");

  if (!minPrice.isZero() && !maxPrice.isZero() && maxPrice.lt(minPrice)) {
    throw new TradingMathError("INVALID_ARGUMENT", "maxPrice is less than minPrice");
  }

  if (!minPrice.isZero() && price.lt(minPrice)) {
    throw new TradingMathError("INVALID_ARGUMENT", "price is below minPrice");
  }

  if (!maxPrice.isZero() && price.gt(maxPrice)) {
    throw new TradingMathError("INVALID_ARGUMENT", "price is above maxPrice");
  }

  if (!tickSize.isZero() && !isOnGrid(price, minPrice, tickSize)) {
    throw new TradingMathError("INVALID_ARGUMENT", "price is not aligned to tickSize");
  }
}

export function isQuantityOnStep(params: {
  quantity: string;
  minQty: string;
  stepSize: string;
}): boolean {
  const quantity = parseCommittedPositive(params.quantity, "quantity");
  const minQty = parseCommittedPositive(params.minQty, "minQty");
  const stepSize = parseCommittedPositive(params.stepSize, "stepSize");
  return isOnGrid(quantity, minQty, stepSize);
}

export function isQuantityInRange(params: {
  quantity: string;
  minQty: string;
  maxQty: string;
}): boolean {
  const quantity = parseCommittedPositive(params.quantity, "quantity");
  const minQty = parseCommittedPositive(params.minQty, "minQty");
  const maxQty = parseCommittedPositive(params.maxQty, "maxQty");

  if (maxQty.lt(minQty)) {
    throw new TradingMathError("INVALID_ARGUMENT", "maxQty is less than minQty");
  }

  return quantity.gte(minQty) && quantity.lte(maxQty);
}

export function validateQuantityFilter(params: {
  quantity: string;
  minQty: string;
  maxQty: string;
  stepSize: string;
}): void {
  const quantity = parseCommittedPositive(params.quantity, "quantity");
  const minQty = parseCommittedPositive(params.minQty, "minQty");
  const maxQty = parseCommittedPositive(params.maxQty, "maxQty");
  const stepSize = parseCommittedPositive(params.stepSize, "stepSize");

  if (maxQty.lt(minQty)) {
    throw new TradingMathError("INVALID_ARGUMENT", "maxQty is less than minQty");
  }

  if (quantity.lt(minQty)) {
    throw new TradingMathError("INVALID_ARGUMENT", "quantity is below minQty");
  }

  if (quantity.gt(maxQty)) {
    throw new TradingMathError("INVALID_ARGUMENT", "quantity is above maxQty");
  }

  if (!isOnGrid(quantity, minQty, stepSize)) {
    throw new TradingMathError("INVALID_ARGUMENT", "quantity is not aligned to stepSize");
  }
}

export function satisfiesMinNotional(params: {
  quantity: string;
  price: string;
  minNotional: string;
}): boolean {
  const quantity = parseCommittedDecimal(params.quantity, "quantity");
  const price = parseCommittedPositive(params.price, "price");
  const minNotional = parseCommittedPositive(params.minNotional, "minNotional");
  return quantity.abs().times(price).gte(minNotional);
}

export function validateMinNotional(params: {
  quantity: string;
  price: string;
  minNotional: string;
}): void {
  if (!satisfiesMinNotional(params)) {
    throw new TradingMathError(
      "INVALID_ARGUMENT",
      `notional ${calculateNotional({ quantity: params.quantity, price: params.price })} is below minNotional`,
    );
  }
}
