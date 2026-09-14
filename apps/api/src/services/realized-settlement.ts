import type { FinancialTransaction } from "@notional/db";
import {
  ensureSystemInsuranceAccount,
  ensureSystemTradingPnlAccount,
  ensureUserCashLedgerAccount,
  fromDbDecimal,
  MoneyDecimal,
  postLedgerTransaction,
  updatePaperAccountBalance,
} from "@notional/db";
import { calculateWalletRealizedSettlement } from "@notional/trading";

export function realizedPnlLedgerIdempotencyKey(executionId: string): string {
  return `realized-pnl:${executionId}`;
}

export async function settleCreatedFillRealizedPnlInTx(
  tx: FinancialTransaction,
  params: {
    paperAccountId: string;
    walletBalance: string;
    executionId: string;
    realizedPnlDelta: string;
  },
): Promise<string> {
  const settlement = calculateWalletRealizedSettlement({
    walletBalance: params.walletBalance,
    realizedPnlDelta: params.realizedPnlDelta,
    protectedBalance: "0",
  });

  if (params.realizedPnlDelta === "0" || fromDbDecimal(params.realizedPnlDelta).isZero()) {
    return params.walletBalance;
  }

  const userCash = await ensureUserCashLedgerAccount(tx, params.paperAccountId);
  const tradingPnl = await ensureSystemTradingPnlAccount(tx);
  const insurance = await ensureSystemInsuranceAccount(tx);

  const entries: { ledgerAccountId: string; amount: MoneyDecimal }[] = [
    {
      ledgerAccountId: tradingPnl.id,
      amount: fromDbDecimal(params.realizedPnlDelta).negated(),
    },
  ];

  if (settlement.userWalletDelta !== "0") {
    entries.push({
      ledgerAccountId: userCash.id,
      amount: fromDbDecimal(settlement.userWalletDelta),
    });
  }

  if (settlement.insuranceAbsorption !== "0") {
    entries.push({
      ledgerAccountId: insurance.id,
      amount: fromDbDecimal(settlement.insuranceAbsorption).negated(),
    });
  }

  await postLedgerTransaction(tx, {
    eventType: "REALIZED_PNL",
    idempotencyKey: realizedPnlLedgerIdempotencyKey(params.executionId),
    entries,
  });

  if (settlement.userWalletDelta !== "0") {
    await updatePaperAccountBalance(
      tx,
      params.paperAccountId,
      fromDbDecimal(settlement.nextWalletBalance),
    );
  }

  return settlement.nextWalletBalance;
}
