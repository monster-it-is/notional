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

export async function provisionSignupAllocation(
  userId: string,
): Promise<PaperAccount> {
  return db.transaction((tx) => provisionSignupAllocationInTx(tx, userId));
}

export async function provisionSignupAllocationInTx(
  tx: FinancialTransaction,
  userId: string,
): Promise<PaperAccount> {
  await ensurePaperAccount(tx, userId);
  const account = await lockPaperAccountByUserId(tx, userId);
  const userCash = await ensureUserCashLedgerAccount(tx, account.id);
  const systemFunding = await ensureSystemVirtualFundingAccount(tx);

  const existing = await findSignupAllocationFundingEvent(tx, account.id);

  if (existing) {
    return account;
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

  return updatePaperAccountBalance(tx, account.id, nextBalance);
}
