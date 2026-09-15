import type { FinancialTransaction, PaperAccount, Position } from "@notional/db";
import {
  advancePositionFundingCursor,
  ensurePosition,
  ensureSystemFundingLedgerAccount,
  ensureSystemInsuranceAccount,
  ensureUserCashLedgerAccount,
  findAccountSettlementByAccountAndTime,
  findFundingCycleByInstrumentAndTime,
  findPaperAccountById,
  findSourceStateByInstrumentId,
  fromDbDecimal,
  insertPerpFundingAccountSettlement,
  insertPerpFundingSettlement,
  listDueReadyCyclesForAccount,
  listOpenPositionsByPaperAccountId,
  listUnresolvedScheduledTimesInWindow,
  lockInstrumentsByIdsForTrading,
  lockPositionsByAccountAndInstrumentIds,
  MoneyDecimal,
  postLedgerTransaction,
  sampleFinancialTransactionTime,
  toIsoUtc,
  updateIsolatedFundingState,
  updatePaperAccountBalance,
} from "@notional/db";
import {
  calculateFundingPayment,
  calculateIsolatedFundingSettlement,
  calculateProtectedWalletSettlement,
  sumDecimalValues,
  windowProven,
  type LiveScheduleProof,
} from "@notional/trading";

import { getLiveScheduleProof } from "./funding-sync.js";

export class FundingDataUnavailableError extends Error {
  readonly code = "FUNDING_DATA_UNAVAILABLE" as const;

  constructor() {
    super("FUNDING_DATA_UNAVAILABLE");
    this.name = "FundingDataUnavailableError";
  }
}

export type FundingBarrierResult = {
  account: PaperAccount;
  financialNow: Date;
  settledBatches: Array<{ id: string; fundingTime: Date }>;
  needsLiquidationRecheck: boolean;
  positions: Position[];
};

export async function settleDueFundingForAccountInTx(
  tx: FinancialTransaction,
  params: {
    accountId: string;
    extraInstrumentIds: string[];
    sampleNow?: (executor: FinancialTransaction) => Promise<Date>;
    getLiveScheduleProof?: (instrumentId: string) => LiveScheduleProof | null;
  },
): Promise<FundingBarrierResult> {
  const sampleNow = params.sampleNow ?? sampleFinancialTransactionTime;
  const liveProof = params.getLiveScheduleProof ?? getLiveScheduleProof;
  const financialNow = await sampleNow(tx);
  const openBeforeLock = await listOpenPositionsByPaperAccountId(tx, params.accountId);
  const unionIds = uniqueSorted([
    ...openBeforeLock.map((row) => row.instrumentId),
    ...params.extraInstrumentIds,
  ]);

  if (unionIds.length > 0) {
    await lockInstrumentsByIdsForTrading(tx, unionIds);
  }

  for (const instrumentId of uniqueSorted(params.extraInstrumentIds)) {
    await ensurePosition(tx, params.accountId, instrumentId);
  }

  const positions =
    unionIds.length > 0
      ? await lockPositionsByAccountAndInstrumentIds(tx, params.accountId, unionIds)
      : [];

  const account = await requireAccount(tx, params.accountId);
  const open = positions.filter((row) => !fromDbDecimal(row.quantity).isZero());

  if (open.length === 0) {
    return {
      account,
      financialNow,
      settledBatches: [],
      needsLiquidationRecheck: false,
      positions,
    };
  }

  for (const position of open) {
    await assertWindowProven(tx, position, financialNow, liveProof);
  }

  const readyTimes = await collectDueReadyTimes(tx, params.accountId, financialNow);
  let currentAccount = account;
  const settledBatches: Array<{ id: string; fundingTime: Date }> = [];
  let needsLiquidationRecheck = false;
  let currentPositions = positions;

  for (const fundingTime of readyTimes) {
    const result = await settleAccountAtFundingTime(tx, {
      account: currentAccount,
      positions: currentPositions,
      fundingTime,
      liveProof,
    });
    currentAccount = result.account;
    currentPositions = result.positions;
    if (result.settlement) {
      settledBatches.push({ id: result.settlement.id, fundingTime });
    }
    if (result.movedCollateral) {
      needsLiquidationRecheck = true;
    }
  }

  return {
    account: currentAccount,
    financialNow,
    settledBatches,
    needsLiquidationRecheck,
    positions: currentPositions,
  };
}

async function collectDueReadyTimes(
  tx: FinancialTransaction,
  accountId: string,
  financialNow: Date,
): Promise<Date[]> {
  const cycles = await listDueReadyCyclesForAccount(tx, accountId, financialNow);
  return uniqueSortedDates(cycles.map((cycle) => cycle.fundingTime));
}

async function assertWindowProven(
  tx: FinancialTransaction,
  position: Position,
  financialNow: Date,
  liveProof: (instrumentId: string) => LiveScheduleProof | null,
): Promise<void> {
  if (position.fundingCursorAt.getTime() >= financialNow.getTime()) {
    return;
  }

  const source = await findSourceStateByInstrumentId(tx, position.instrumentId);

  if (!source) {
    throw new FundingDataUnavailableError();
  }

  const unresolvedScheduledTimes = await listUnresolvedScheduledTimesInWindow(
    tx,
    position.instrumentId,
    position.fundingCursorAt,
    financialNow,
  );

  const proven = windowProven({
    cursorAt: toIsoUtc(position.fundingCursorAt),
    financialNow: toIsoUtc(financialNow),
    activationFloorAt: toIsoUtc(source.activationFloorAt),
    lastRealizedFundingTime: source.lastRealizedFundingTime
      ? toIsoUtc(source.lastRealizedFundingTime)
      : null,
    unresolvedScheduledTimes,
    liveScheduleProof: liveProof(position.instrumentId),
  });

  if (!proven) {
    throw new FundingDataUnavailableError();
  }
}

async function settleAccountAtFundingTime(
  tx: FinancialTransaction,
  params: {
    account: PaperAccount;
    positions: Position[];
    fundingTime: Date;
    liveProof: (instrumentId: string) => LiveScheduleProof | null;
  },
): Promise<{
  account: PaperAccount;
  positions: Position[];
  settlement: { id: string } | null;
  movedCollateral: boolean;
}> {
  const existing = await findAccountSettlementByAccountAndTime(
    tx,
    params.account.id,
    params.fundingTime,
  );
  if (existing) {
    return {
      account: params.account,
      positions: params.positions,
      settlement: existing,
      movedCollateral: false,
    };
  }

  const liable = params.positions.filter(
    (row) =>
      !fromDbDecimal(row.quantity).isZero() &&
      row.fundingCursorAt.getTime() < params.fundingTime.getTime(),
  );

  for (const position of liable) {
    await assertWindowProven(tx, position, params.fundingTime, params.liveProof);
  }

  const included: Array<{
    position: Position;
    cycleId: string;
    fundingRate: string;
    markPrice: string;
    payment: string;
  }> = [];

  for (const position of liable) {
    const cycle = await findFundingCycleByInstrumentAndTime(
      tx,
      position.instrumentId,
      params.fundingTime,
    );

    if (!cycle) {
      continue;
    }

    if (cycle.status !== "READY" || cycle.fundingRate === null || cycle.markPrice === null) {
      throw new FundingDataUnavailableError();
    }

    included.push({
      position,
      cycleId: cycle.id,
      fundingRate: cycle.fundingRate,
      markPrice: cycle.markPrice,
      payment: calculateFundingPayment({
        signedQuantity: position.quantity,
        markPrice: cycle.markPrice,
        fundingRate: cycle.fundingRate,
      }),
    });
  }

  if (included.length === 0) {
    return {
      account: params.account,
      positions: params.positions,
      settlement: null,
      movedCollateral: false,
    };
  }

  let wallet = params.account.balance;
  const nextById = new Map(params.positions.map((row) => [row.id, row]));
  const isolatedUserDeltas: string[] = [];
  const isolatedInsurance: string[] = [];
  const crossPayments: string[] = [];
  let movedCollateral = false;

  for (const row of included) {
    if (row.position.marginMode === "ISOLATED") {
      const isolated = calculateIsolatedFundingSettlement({
        isolatedMargin: row.position.isolatedMargin,
        fundingPayment: row.payment,
      });
      isolatedUserDeltas.push(isolated.userWalletDelta);
      isolatedInsurance.push(isolated.insuranceAbsorption);
      const updated = await updateIsolatedFundingState(tx, row.position.id, {
        isolatedMargin: isolated.nextIsolatedMargin,
        fundingCursorAt: params.fundingTime,
      });
      nextById.set(updated.id, updated);
      wallet = sumDecimalValues([wallet, isolated.userWalletDelta]);
      if (isolated.userWalletDelta !== "0" || isolated.nextIsolatedMargin !== row.position.isolatedMargin) {
        movedCollateral = true;
      }
    } else {
      crossPayments.push(row.payment);
    }
  }

  const crossDelta = sumDecimalValues(crossPayments);
  const protectedBalance = sumDecimalValues(
    [...nextById.values()].map((row) => row.isolatedMargin),
  );
  const crossSettle = calculateProtectedWalletSettlement({
    walletBalance: wallet,
    cashDelta: crossDelta,
    protectedBalance,
  });
  wallet = crossSettle.nextWalletBalance;

  if (crossDelta !== "0") {
    movedCollateral = true;
  }

  for (const row of included) {
    if (row.position.marginMode === "CROSS") {
      const updated = await advancePositionFundingCursor(tx, row.position.id, params.fundingTime);
      nextById.set(updated.id, updated);
    }
  }

  const totalFundingPayment = sumDecimalValues(included.map((row) => row.payment));
  const totalUserWalletDelta = sumDecimalValues([
    ...isolatedUserDeltas,
    crossSettle.userWalletDelta,
  ]);
  const totalInsuranceAbsorption = sumDecimalValues([
    ...isolatedInsurance,
    crossSettle.insuranceAbsorption,
  ]);

  const account = await updatePaperAccountBalance(
    tx,
    params.account.id,
    fromDbDecimal(wallet),
  );

  const accountSettlement = await insertPerpFundingAccountSettlement(tx, {
    paperAccountId: params.account.id,
    fundingTime: params.fundingTime,
    totalFundingPayment,
    userWalletDelta: totalUserWalletDelta,
    insuranceAbsorption: totalInsuranceAbsorption,
  });

  for (const row of included) {
    const next = nextById.get(row.position.id) ?? row.position;
    await insertPerpFundingSettlement(tx, {
      fundingCycleId: row.cycleId,
      paperAccountId: params.account.id,
      positionId: row.position.id,
      fundingAccountSettlementId: accountSettlement.id,
      marginMode: row.position.marginMode,
      quantity: row.position.quantity,
      fundingPayment: row.payment,
      isolatedMarginBefore:
        row.position.marginMode === "ISOLATED" ? row.position.isolatedMargin : null,
      isolatedMarginAfter: row.position.marginMode === "ISOLATED" ? next.isolatedMargin : null,
    });
  }

  await postFundingLedger(tx, {
    paperAccountId: params.account.id,
    accountSettlementId: accountSettlement.id,
    totalFundingPayment,
    totalUserWalletDelta,
    totalInsuranceAbsorption,
  });

  return {
    account,
    positions: params.positions.map((row) => nextById.get(row.id) ?? row),
    settlement: accountSettlement,
    movedCollateral,
  };
}

async function postFundingLedger(
  tx: FinancialTransaction,
  params: {
    paperAccountId: string;
    accountSettlementId: string;
    totalFundingPayment: string;
    totalUserWalletDelta: string;
    totalInsuranceAbsorption: string;
  },
): Promise<void> {
  const entries: { ledgerAccountId: string; amount: MoneyDecimal }[] = [];
  const funding = await ensureSystemFundingLedgerAccount(tx);
  const total = fromDbDecimal(params.totalFundingPayment);

  if (!total.isZero()) {
    entries.push({ ledgerAccountId: funding.id, amount: total.negated() });
  }

  if (params.totalUserWalletDelta !== "0") {
    const userCash = await ensureUserCashLedgerAccount(tx, params.paperAccountId);
    entries.push({
      ledgerAccountId: userCash.id,
      amount: fromDbDecimal(params.totalUserWalletDelta),
    });
  }

  if (params.totalInsuranceAbsorption !== "0") {
    const insurance = await ensureSystemInsuranceAccount(tx);
    entries.push({
      ledgerAccountId: insurance.id,
      amount: fromDbDecimal(params.totalInsuranceAbsorption).negated(),
    });
  }

  if (entries.length === 0) {
    return;
  }

  if (entries.length < 2) {
    throw new Error("funding ledger requires balanced nonzero entries");
  }

  await postLedgerTransaction(tx, {
    eventType: "FUNDING_PAYMENT",
    idempotencyKey: `funding-payment:${params.accountSettlementId}`,
    entries,
  });
}

async function requireAccount(
  tx: FinancialTransaction,
  accountId: string,
): Promise<PaperAccount> {
  const account = await findPaperAccountById(tx, accountId);
  if (!account) {
    throw new Error("paper_account missing during funding barrier");
  }
  return account;
}

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function uniqueSortedDates(values: Date[]): Date[] {
  const byMs = new Map<number, Date>();
  for (const value of values) {
    byMs.set(value.getTime(), value);
  }
  return [...byMs.values()].sort((left, right) => left.getTime() - right.getTime());
}
