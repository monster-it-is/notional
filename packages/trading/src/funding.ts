import {
  parseNonNegativeValue,
  parsePlainDecimal,
  parsePositiveValue,
  quantizeToNumeric3818,
  quantizeValue,
  toCanonicalFromDecimal,
} from "./decimal.js";
import { TradingMathError } from "./errors.js";
import { calculatePersistedIsolatedMargin } from "./margin.js";
import { classifyPositionTransition, type PositionTransition } from "./position.js";

export type LiveScheduleProof = {
  validFrom: string;
  nextFundingTime: string;
  observedAt: string;
};

export type IsolatedFundingSettlement = {
  nextIsolatedMargin: string;
  userWalletDelta: string;
  insuranceAbsorption: string;
};

export function persistFundingRateToNumeric3818(rate: string): string {
  const parsed = parsePlainDecimal(rate);

  if (parsed.abs().gte(1)) {
    throw new TradingMathError("INVALID_ARGUMENT", "funding rate abs must be < 1");
  }

  const persisted = quantizeValue(parsed);

  if (parsePlainDecimal(persisted).abs().gte(1)) {
    throw new TradingMathError("INVALID_ARGUMENT", "funding rate abs must be < 1");
  }

  return persisted;
}

export function persistFundingMarkToNumeric3818(markPrice: string): string {
  return quantizeValue(parsePositiveValue(markPrice, "markPrice"));
}

export function expectedMarkCandleCloseTimeMs(fundingTimeMs: number): number {
  if (!Number.isSafeInteger(fundingTimeMs) || fundingTimeMs < 0) {
    throw new TradingMathError("INVALID_ARGUMENT", "fundingTimeMs must be a safe non-negative integer");
  }

  return Math.floor(fundingTimeMs / 60_000) * 60_000 - 1;
}

export function calculateFundingPayment(params: {
  signedQuantity: string;
  markPrice: string;
  fundingRate: string;
}): string {
  const signedQuantity = parsePlainDecimal(params.signedQuantity);
  const markPrice = parsePositiveValue(params.markPrice, "markPrice");
  const fundingRate = parsePlainDecimal(params.fundingRate);

  if (fundingRate.abs().gte(1)) {
    throw new TradingMathError("INVALID_ARGUMENT", "funding rate abs must be < 1");
  }

  try {
    return quantizeToNumeric3818(
      toCanonicalFromDecimal(signedQuantity.times(markPrice).times(fundingRate).negated()),
    );
  } catch (error) {
    if (error instanceof TradingMathError && error.code === "OVERFLOW") {
      throw new TradingMathError("OVERFLOW", "funding payment exceeds NUMERIC(38,18)");
    }

    throw error;
  }
}

export function calculateIsolatedFundingSettlement(params: {
  isolatedMargin: string;
  fundingPayment: string;
}): IsolatedFundingSettlement {
  const isolatedMargin = parseNonNegativeValue(params.isolatedMargin, "isolatedMargin");
  const fundingPayment = parsePlainDecimal(params.fundingPayment);

  if (fundingPayment.isZero()) {
    return {
      nextIsolatedMargin: toCanonicalFromDecimal(isolatedMargin),
      userWalletDelta: "0",
      insuranceAbsorption: "0",
    };
  }

  if (fundingPayment.isPositive()) {
    const next = isolatedMargin.plus(fundingPayment);
    return {
      nextIsolatedMargin: persistFit(next),
      userWalletDelta: persistFit(fundingPayment),
      insuranceAbsorption: "0",
    };
  }

  const loss = fundingPayment.abs();
  const userLoss = loss.lte(isolatedMargin) ? loss : isolatedMargin;
  const insuranceAbsorption = loss.minus(userLoss);

  return {
    nextIsolatedMargin: persistFit(isolatedMargin.minus(userLoss)),
    userWalletDelta: userLoss.isZero() ? "0" : persistFit(userLoss.negated()),
    insuranceAbsorption: persistFit(insuranceAbsorption),
  };
}

export function calculateNextIsolatedCollateralAfterFill(params: {
  currentQty: string;
  currentEntryPrice: string | null;
  currentIsolatedMargin: string;
  nextQty: string;
  nextEntryPrice: string | null;
  leverage: string;
  fillSide: "BUY" | "SELL";
  fillQty: string;
}): string {
  const transition = classifyPositionTransition({
    currentQty: params.currentQty,
    fillSide: params.fillSide,
    fillQty: params.fillQty,
  });

  if (transition === "REVERSE") {
    throw new TradingMathError("INVALID_ARGUMENT", "ISOLATED REVERSE is not supported");
  }

  const currentIsolatedMargin = parseNonNegativeValue(
    params.currentIsolatedMargin,
    "currentIsolatedMargin",
  );
  const requiredBefore = parsePlainDecimal(
    calculatePersistedIsolatedMargin({
      positionQty: params.currentQty,
      entryPrice: params.currentEntryPrice,
      leverage: params.leverage,
    }),
  );
  const requiredAfter = parsePlainDecimal(
    calculatePersistedIsolatedMargin({
      positionQty: params.nextQty,
      entryPrice: params.nextEntryPrice,
      leverage: params.leverage,
    }),
  );

  if (transition === "OPEN") {
    return toCanonicalFromDecimal(requiredAfter);
  }

  if (transition === "CLOSE") {
    return "0";
  }

  if (transition === "INCREASE") {
    return persistFit(currentIsolatedMargin.plus(requiredAfter.minus(requiredBefore)));
  }

  const requirementReleased = requiredBefore.minus(requiredAfter);
  const actualReleased = currentIsolatedMargin.lte(requirementReleased)
    ? currentIsolatedMargin
    : requirementReleased;
  return persistFit(currentIsolatedMargin.minus(actualReleased));
}

export function isolatedIncreaseRequiresHealthyCollateral(params: {
  currentIsolatedMargin: string;
  currentQty: string;
  currentEntryPrice: string | null;
  leverage: string;
  transition: PositionTransition;
}): boolean {
  if (params.transition !== "INCREASE") {
    return true;
  }

  const current = parseNonNegativeValue(params.currentIsolatedMargin, "currentIsolatedMargin");
  const requiredBefore = parsePlainDecimal(
    calculatePersistedIsolatedMargin({
      positionQty: params.currentQty,
      entryPrice: params.currentEntryPrice,
      leverage: params.leverage,
    }),
  );
  return current.gte(requiredBefore);
}

export function effectiveProofBase(params: {
  lastRealizedFundingTime: string | null;
  activationFloorAt: string;
}): string {
  return params.lastRealizedFundingTime ?? params.activationFloorAt;
}

export function windowProven(params: {
  cursorAt: string;
  financialNow: string;
  activationFloorAt: string;
  lastRealizedFundingTime: string | null;
  unresolvedScheduledTimes: string[];
  liveScheduleProof: LiveScheduleProof | null;
}): boolean {
  const cursor = timestampMs(params.cursorAt, "cursorAt");
  const financialNow = timestampMs(params.financialNow, "financialNow");

  if (financialNow <= cursor) {
    return true;
  }

  for (const scheduled of params.unresolvedScheduledTimes) {
    const time = timestampMs(scheduled, "unresolvedScheduledTime");
    if (time > cursor && time <= financialNow) {
      return false;
    }
  }

  const lastRealized =
    params.lastRealizedFundingTime === null
      ? null
      : timestampMs(params.lastRealizedFundingTime, "lastRealizedFundingTime");

  if (lastRealized !== null && lastRealized > financialNow) {
    return true;
  }

  const coveredThrough =
    lastRealized === null
      ? timestampMs(params.activationFloorAt, "activationFloorAt")
      : lastRealized;

  if (coveredThrough >= financialNow) {
    return true;
  }

  const proof = params.liveScheduleProof;
  if (proof === null) {
    return false;
  }

  const validFrom = timestampMs(proof.validFrom, "validFrom");
  const nextFundingTime = timestampMs(proof.nextFundingTime, "nextFundingTime");

  if (nextFundingTime <= financialNow) {
    return false;
  }

  return validFrom <= coveredThrough;
}

function persistFit(value: ReturnType<typeof parsePlainDecimal>): string {
  try {
    return quantizeValue(value);
  } catch (error) {
    if (error instanceof TradingMathError && error.code === "OVERFLOW") {
      throw new TradingMathError("OVERFLOW", "funding amount exceeds NUMERIC(38,18)");
    }

    throw error;
  }
}

function timestampMs(value: string, label: string): number {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TradingMathError("INVALID_ARGUMENT", `${label} must be an ISO timestamp`);
  }

  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    throw new TradingMathError("INVALID_ARGUMENT", `${label} must be an ISO timestamp`);
  }

  return parsed;
}
