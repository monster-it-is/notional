export {
  assertFitsNumeric3818,
  NUMERIC_INTEGER_DIGITS,
  NUMERIC_PRECISION,
  NUMERIC_SCALE,
  parseDecimalString,
  parseNonNegativeDecimalString,
  parsePositiveDecimalString,
  quantizeToNumeric3818,
  toCanonicalDecimalString,
} from "./decimal.js";
export { TradingMathError } from "./errors.js";
export type { TradingMathErrorCode } from "./errors.js";
export {
  getLimitExecutionPrice,
  getMarketExecutionPrice,
  isLimitMarketable,
} from "./execution-price.js";
export type {
  LimitMarketabilityInput,
  MarketExecutionPriceInput,
} from "./execution-price.js";
export {
  isPriceInRange,
  isQuantityInRange,
  isQuantityOnStep,
  isTickAligned,
  satisfiesMinNotional,
  validateMinNotional,
  validatePriceFilter,
  validateQuantityFilter,
} from "./filters.js";
export { calculateInitialMargin } from "./margin.js";
export { calculateNotional } from "./notional.js";
export { calculateRealizedPnl, calculateUnrealizedPnl } from "./pnl.js";
export {
  applyFillToPosition,
  classifyPositionTransition,
  positionSide,
  signedFillQuantity,
} from "./position.js";
export type {
  ApplyFillInput,
  ApplyFillResult,
  OrderSide,
  PositionSide,
  PositionTransition,
} from "./position.js";

void (true satisfies Extract<
  keyof typeof import("./index.js"),
  | "TradingDecimal"
  | "realizedPnlValue"
  | "parsePlainDecimal"
  | "toCanonicalFromDecimal"
  | "assertFitsValue"
  | "quantizeValue"
  | "signedFillValue"
  | "parseOptionalEntry"
  | "parseCommittedDecimal"
> extends never
  ? true
  : false);

