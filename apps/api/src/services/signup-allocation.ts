import {
  db,
  ensurePaperAccount,
  ensureSystemVirtualFundingAccount,
  ensureUserCashLedgerAccount,
  findSignupAllocationFundingEvent,
  fromDbDecimal,
  insertFundingEvent,
  lockPaperAccountByUserId,
  postLedgerTransaction,
  SIGNUP_ALLOCATION_AMOUNT,
  signupAllocationIdempotencyKey,
  updatePaperAccountBalance,
  type FinancialTransaction,
  type PaperAccount,
} from "@notional/db";
import { silentLogger, type Logger } from "../market-data/types.js";
import {
  accountInitializedEffect,
  safeOnPrivateCommitted,
  type CommittedPrivateEffect,
} from "../realtime/effects.js";

export async function provisionSignupAllocation(
  userId: string,
  onPrivateCommitted?: (effect: CommittedPrivateEffect) => void,
  logger: Logger = silentLogger,
): Promise<PaperAccount> {
  const result = await db.transaction((tx) => provisionSignupAllocationInTx(tx, userId));
  if (result.credited) {
    safeOnPrivateCommitted(
      onPrivateCommitted,
      accountInitializedEffect(result.account.id),
      logger,
    );
  }
  return result.account;
}

export async function provisionSignupAllocationInTx(
  tx: FinancialTransaction,
  userId: string,
): Promise<{ account: PaperAccount; credited: boolean }> {
  await ensurePaperAccount(tx, userId);
  const account = await lockPaperAccountByUserId(tx, userId);
  const userCash = await ensureUserCashLedgerAccount(tx, account.id);
  const systemFunding = await ensureSystemVirtualFundingAccount(tx);

  const existing = await findSignupAllocationFundingEvent(tx, account.id);

  if (existing) {
    return { account, credited: false };
  }

  const idempotencyKey = signupAllocationIdempotencyKey(userId);

  const ledgerTxn = await postLedgerTransaction(tx, {
    eventType: "SIGNUP_ALLOCATION",
    idempotencyKey,
    entries: [
      {
        ledgerAccountId: userCash.id,
        amount: SIGNUP_ALLOCATION_AMOUNT,
      },
      {
        ledgerAccountId: systemFunding.id,
        amount: SIGNUP_ALLOCATION_AMOUNT.negated(),
      },
    ],
  });

  await insertFundingEvent(tx, {
    paperAccountId: account.id,
    eventType: "SIGNUP_ALLOCATION",
    amount: SIGNUP_ALLOCATION_AMOUNT,
    idempotencyKey,
    ledgerTransactionId: ledgerTxn.id,
  });

  const nextBalance = fromDbDecimal(account.balance).plus(
    SIGNUP_ALLOCATION_AMOUNT,
  );

  return {
    account: await updatePaperAccountBalance(tx, account.id, nextBalance),
    credited: true,
  };
}
