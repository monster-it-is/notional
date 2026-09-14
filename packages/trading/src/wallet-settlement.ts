import {
  assertFitsValue,
  parseNonNegativeValue,
  parsePlainDecimal,
  toCanonicalFromDecimal,
  type TradingDecimal,
} from "./decimal.js";
import { TradingMathError } from "./errors.js";

export type WalletRealizedSettlement = {
  nextWalletBalance: string;
  userWalletDelta: string;
  insuranceAbsorption: string;
};

export function calculateWalletRealizedSettlement(params: {
  walletBalance: string;
  realizedPnlDelta: string;
  protectedBalance: string;
}): WalletRealizedSettlement {
  const walletBalance = parseNonNegativeValue(params.walletBalance, "walletBalance");
  const protectedBalance = parseNonNegativeValue(
    params.protectedBalance,
    "protectedBalance",
  );
  const realizedPnlDelta = parsePlainDecimal(params.realizedPnlDelta);

  if (protectedBalance.gt(walletBalance)) {
    throw new TradingMathError(
      "INVALID_ARGUMENT",
      "protectedBalance must not exceed walletBalance",
    );
  }

  if (realizedPnlDelta.isZero()) {
    return {
      nextWalletBalance: persistFit(walletBalance),
      userWalletDelta: "0",
      insuranceAbsorption: "0",
    };
  }

  if (realizedPnlDelta.isPositive()) {
    return {
      nextWalletBalance: persistFit(walletBalance.plus(realizedPnlDelta)),
      userWalletDelta: persistFit(realizedPnlDelta),
      insuranceAbsorption: "0",
    };
  }

  const loss = realizedPnlDelta.abs();
  const spendable = walletBalance.minus(protectedBalance);
  const userLoss = loss.lte(spendable) ? loss : spendable;
  const insuranceAbsorption = loss.minus(userLoss);

  return {
    nextWalletBalance: persistFit(walletBalance.minus(userLoss)),
    userWalletDelta: userLoss.isZero() ? "0" : persistFit(userLoss.negated()),
    insuranceAbsorption: persistFit(insuranceAbsorption),
  };
}

function persistFit(value: TradingDecimal): string {
  try {
    assertFitsValue(value);
  } catch (error) {
    if (error instanceof TradingMathError && error.code === "OVERFLOW") {
      throw new TradingMathError("OVERFLOW", "settlement amount exceeds NUMERIC(38,18)");
    }

    throw error;
  }

  return toCanonicalFromDecimal(value);
}
