export type TradingMathErrorCode =
  | "INVALID_DECIMAL"
  | "INVALID_ARGUMENT"
  | "INVARIANT_VIOLATION"
  | "OVERFLOW";

export class TradingMathError extends Error {
  readonly code: TradingMathErrorCode;

  constructor(code: TradingMathErrorCode, message: string) {
    super(message);
    this.name = "TradingMathError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
