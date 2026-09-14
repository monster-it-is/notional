export {
  addNumeric3818Exact,
  assertFitsNumeric3818,
  isDecimalGte,
  isDecimalLte,
  NUMERIC_INTEGER_DIGITS,
  NUMERIC_PRECISION,
  NUMERIC_SCALE,
  parseDecimalString,
  parseNonNegativeDecimalString,
  parsePositiveDecimalString,
  quantizeCollateralRequirementToNumeric3818,
  quantizeToNumeric3818,
  sumDecimalValues,
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
export {
  calculateAvailableBalance,
  calculateCrossCollateral,
  calculateInitialMargin,
  calculateIsolatedEquity,
  calculateMaintenanceMargin,
  calculatePersistedIsolatedMargin,
  calculateRequiredIsolatedMargin,
  DEFAULT_LEVERAGE,
  DEFAULT_MARGIN_MODE,
  isMaintenanceBreached,
  MAINTENANCE_MARGIN_RATE,
  MAX_LEVERAGE,
  MIN_LEVERAGE,
} from "./margin.js";
export type { MarginMode } from "./margin.js";
export { calculateNotional } from "./notional.js";
export { calculateRealizedPnl, calculateUnrealizedPnl } from "./pnl.js";
export {
  applyFillToPosition,
  classifyPositionTransition,
  positionSide,
  signedFillQuantity,
  toPersistedFillState,
} from "./position.js";
export type {
  ApplyFillInput,
  ApplyFillResult,
  OrderSide,
  PersistedFillState,
  PositionSide,
  PositionTransition,
} from "./position.js";
export {
  calculateIsolatedReduceProtectedBalance,
  calculateWalletRealizedSettlement,
} from "./wallet-settlement.js";
export type { WalletRealizedSettlement } from "./wallet-settlement.js";

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

