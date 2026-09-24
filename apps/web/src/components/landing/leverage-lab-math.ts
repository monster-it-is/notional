import {
  addNumeric3818Exact,
  calculateInitialMargin,
  calculateMaintenanceMargin,
  calculateNotional,
  calculateUnrealizedPnl,
  isDecimalGte,
  isDecimalLte,
  isMaintenanceBreached,
  MAINTENANCE_MARGIN_RATE,
  MAX_LEVERAGE,
  MIN_LEVERAGE,
  parsePositiveDecimalString,
} from "@notional/trading";

export type LabDirection = "LONG" | "SHORT";

export type LabFigures = {
  notional: string;
  initialMargin: string;
  estimatedPnl: string;
  roePercent: string;
  equity: string;
  markPrice: string | null;
  maintenanceMargin: string;
  maintenanceBreached: boolean;
};

export type LabEstimate =
  | { ok: true; figures: LabFigures }
  | { ok: false; reason: "margin" | "leverage" | "move" };

/**
 * Isolated-margin illustration.
 * Notional = margin × leverage, via calculateNotional.
 * PnL uses calculateUnrealizedPnl on a unit entry so the result equals notional × move.
 * Maintenance uses calculateNotional at the moved mark, matching isolated liquidation risk.
 * ROE percent points equal leverage × the integer move. Fees, funding, and execution
 * price are excluded. This is not an order and not a forecast.
 */
const MOVE_FACTOR: Record<string, string> = {
  "-10": "0.9",
  "-9": "0.91",
  "-8": "0.92",
  "-7": "0.93",
  "-6": "0.94",
  "-5": "0.95",
  "-4": "0.96",
  "-3": "0.97",
  "-2": "0.98",
  "-1": "0.99",
  "0": "1",
  "1": "1.01",
  "2": "1.02",
  "3": "1.03",
  "4": "1.04",
  "5": "1.05",
  "6": "1.06",
  "7": "1.07",
  "8": "1.08",
  "9": "1.09",
  "10": "1.1",
};

export function estimateLeverageScenario(input: {
  direction: LabDirection;
  margin: string;
  leverage: string;
  movePercent: string;
  entryPrice: string;
}): LabEstimate {
  const margin = input.margin.trim();
  const leverage = input.leverage.trim();
  const movePercent = input.movePercent === "-0" ? "0" : input.movePercent.trim();
  const factor = MOVE_FACTOR[movePercent];

  if (!factor) {
    return { ok: false, reason: "move" };
  }

  if (!/^[1-9]\d*$/.test(leverage)) {
    return { ok: false, reason: "leverage" };
  }

  if (
    !isDecimalGte(leverage, String(MIN_LEVERAGE)) ||
    !isDecimalLte(leverage, String(MAX_LEVERAGE))
  ) {
    return { ok: false, reason: "leverage" };
  }

  let notional: string;

  try {
    parsePositiveDecimalString(margin);
    notional = calculateNotional({ quantity: margin, price: leverage });
  } catch {
    return { ok: false, reason: "margin" };
  }

  const initialMargin = calculateInitialMargin({ notional, leverage });
  const positionQty = input.direction === "LONG" ? notional : `-${notional}`;
  const estimatedPnl = calculateUnrealizedPnl({
    positionQty,
    entryPrice: "1",
    markPrice: factor,
  });
  const equity = addNumeric3818Exact(initialMargin, estimatedPnl);
  const maintenanceMargin = calculateMaintenanceMargin({
    notional: calculateNotional({
      quantity: positionQty,
      price: factor,
    }),
    maintenanceMarginRate: MAINTENANCE_MARGIN_RATE,
  });
  const maintenanceBreached = isMaintenanceBreached({
    equity,
    maintenanceMargin,
  });
  const illustrativeMarkPrice = illustrativeMark(input.entryPrice.trim(), factor);

  return {
    ok: true,
    figures: {
      notional,
      initialMargin,
      estimatedPnl,
      roePercent: roePercent(input.direction, leverage, movePercent),
      equity,
      markPrice: illustrativeMarkPrice,
      maintenanceMargin,
      maintenanceBreached,
    },
  };
}

function roePercent(direction: LabDirection, leverage: string, movePercent: string): string {
  const steps = moveSteps(movePercent);

  if (steps === 0) {
    return "0";
  }

  const magnitude = repeatAdd(leverage, steps);
  const moveDown = movePercent.startsWith("-");
  const gain = direction === "LONG" ? !moveDown : moveDown;
  return gain ? magnitude : `-${magnitude}`;
}

function moveSteps(movePercent: string): number {
  const digits = movePercent.startsWith("-") ? movePercent.slice(1) : movePercent;

  if (digits === "10") {
    return 10;
  }

  const code = digits.codePointAt(0);
  return code === undefined ? 0 : code - 48;
}

function repeatAdd(value: string, times: number): string {
  let sum = "0";

  for (let step = 0; step < times; step += 1) {
    sum = addNumeric3818Exact(sum, value);
  }

  return sum;
}

function illustrativeMark(entryPrice: string, factor: string): string | null {
  if (entryPrice === "" || entryPrice === "." || /^\d+\.$/.test(entryPrice)) {
    return null;
  }

  let canonical: string;

  try {
    canonical = parsePositiveDecimalString(entryPrice);
  } catch {
    return null;
  }

  return calculateNotional({ quantity: canonical, price: factor });
}
