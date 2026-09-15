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

export function calculateProtectedWalletSettlement(params: {
  walletBalance: string;
  cashDelta: string;
  protectedBalance: string;
}): WalletRealizedSettlement {
  const walletBalance = parseNonNegativeValue(params.walletBalance, "walletBalance");
  const protectedBalance = parseNonNegativeValue(
    params.protectedBalance,
    "protectedBalance",
  );
  const cashDelta = parsePlainDecimal(params.cashDelta);

  if (protectedBalance.gt(walletBalance)) {
    throw new TradingMathError(
      "INVALID_ARGUMENT",
      "protectedBalance must not exceed walletBalance",
    );
  }

  if (cashDelta.isZero()) {
    return {
      nextWalletBalance: persistFit(walletBalance),
      userWalletDelta: "0",
      insuranceAbsorption: "0",
    };
  }

  if (cashDelta.isPositive()) {
    return {
      nextWalletBalance: persistFit(walletBalance.plus(cashDelta)),
      userWalletDelta: persistFit(cashDelta),
      insuranceAbsorption: "0",
    };
  }

  const loss = cashDelta.abs();
  const spendable = walletBalance.minus(protectedBalance);
  const userLoss = loss.lte(spendable) ? loss : spendable;
  const insuranceAbsorption = loss.minus(userLoss);

  return {
    nextWalletBalance: persistFit(walletBalance.minus(userLoss)),
    userWalletDelta: userLoss.isZero() ? "0" : persistFit(userLoss.negated()),
    insuranceAbsorption: persistFit(insuranceAbsorption),
  };
}

export function calculateWalletRealizedSettlement(params: {
  walletBalance: string;
  realizedPnlDelta: string;
  protectedBalance: string;
}): WalletRealizedSettlement {
  return calculateProtectedWalletSettlement({
    walletBalance: params.walletBalance,
    cashDelta: params.realizedPnlDelta,
    protectedBalance: params.protectedBalance,
  });
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

export function calculateIsolatedReduceProtectedBalance(params: {
  walletBalance: string;
  currentIsolatedMargin: string;
  nextIsolatedMargin: string;
}): { lossCapacity: string; protectedBalance: string } {
  const walletBalance = parseNonNegativeValue(params.walletBalance, "walletBalance");
  const currentIsolatedMargin = parseNonNegativeValue(
    params.currentIsolatedMargin,
    "currentIsolatedMargin",
  );
  const nextIsolatedMargin = parseNonNegativeValue(
    params.nextIsolatedMargin,
    "nextIsolatedMargin",
  );

  if (nextIsolatedMargin.gt(currentIsolatedMargin)) {
    throw new TradingMathError(
      "INVARIANT_VIOLATION",
      "nextIsolatedMargin must not exceed currentIsolatedMargin",
    );
  }

  const lossCapacity = currentIsolatedMargin.minus(nextIsolatedMargin);
  const protectedBalance = walletBalance.minus(lossCapacity);

  if (protectedBalance.isNegative()) {
    throw new TradingMathError(
      "INVARIANT_VIOLATION",
      "isolated loss capacity exceeds walletBalance",
    );
  }

  return {
    lossCapacity: persistFit(lossCapacity),
    protectedBalance: persistFit(protectedBalance),
  };
}
