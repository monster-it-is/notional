import { expect } from "vitest";

import { TradingMathError } from "./errors.js";
import type { TradingMathErrorCode } from "./errors.js";

export function expectTradingCode(
  fn: () => unknown,
  code: TradingMathErrorCode,
): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TradingMathError);
    expect((error as TradingMathError).code).toBe(code);
    return;
  }

  throw new Error(`expected TradingMathError ${code}`);
}

export function fractionalDigitCount(value: string): number {
  const [, fraction = ""] = value.split(".");
  return fraction.length;
}
