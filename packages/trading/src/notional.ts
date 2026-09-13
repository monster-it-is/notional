import {
  parseCommittedDecimal,
  parseCommittedPositive,
  toCanonicalFromDecimal,
} from "./decimal.js";

export function calculateNotional(params: {
  quantity: string;
  price: string;
}): string {
  const quantity = parseCommittedDecimal(params.quantity, "quantity");
  const price = parseCommittedPositive(params.price, "price");
  return toCanonicalFromDecimal(quantity.abs().times(price));
}
