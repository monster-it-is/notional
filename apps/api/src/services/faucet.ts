import { randomUUID } from "node:crypto";

import {
  applyFaucetClaim,
  db,
  ensureSystemVirtualFundingAccount,
  ensureUserCashLedgerAccount,
  faucetClaimIdempotencyKey,
  findPaperAccountByUserId,
  findSignupAllocationFundingEvent,
  fromDbDecimal,
  insertFundingEvent,
  lockPaperAccountByUserId,
  postLedgerTransaction,
  readFaucetCooldownState,
  type FinancialTransaction,
  type PaperAccount,
} from "@notional/db";

import { env } from "../env.js";

export class FaucetClaimError extends Error {
  readonly code:
    | "ACCOUNT_NOT_INITIALIZED"
    | "ACCOUNT_SUSPENDED"
    | "FAUCET_COOLDOWN";
  readonly nextClaimAt: Date | null;

  constructor(
    code: "ACCOUNT_NOT_INITIALIZED" | "ACCOUNT_SUSPENDED" | "FAUCET_COOLDOWN",
    nextClaimAt: Date | null = null,
  ) {
    super(code);
    this.name = "FaucetClaimError";
    this.code = code;
    this.nextClaimAt = nextClaimAt;
  }
}

export async function claimFaucet(userId: string): Promise<PaperAccount> {
  return db.transaction((tx) => claimFaucetInTx(tx, userId));
}

export async function claimFaucetInTx(
  tx: FinancialTransaction,
  userId: string,
): Promise<PaperAccount> {
  const existing = await findPaperAccountByUserId(tx, userId);

  if (!existing) {
    throw new FaucetClaimError("ACCOUNT_NOT_INITIALIZED");
  }

  const account = await lockPaperAccountByUserId(tx, userId);
  const allocation = await findSignupAllocationFundingEvent(tx, account.id);

  if (!allocation) {
    throw new FaucetClaimError("ACCOUNT_NOT_INITIALIZED");
  }

  if (account.status === "SUSPENDED") {
    throw new FaucetClaimError("ACCOUNT_SUSPENDED");
  }

  const cooldown = await readFaucetCooldownState(tx, account.id);

  if (!cooldown.eligible) {
    if (!cooldown.nextClaimAt) {
      throw new Error("FAUCET_COOLDOWN missing nextClaimAt");
    }

    throw new FaucetClaimError("FAUCET_COOLDOWN", cooldown.nextClaimAt);
  }

  const userCash = await ensureUserCashLedgerAccount(tx, account.id);
  const systemFunding = await ensureSystemVirtualFundingAccount(tx);
  const faucetAmount = env.FAUCET_AMOUNT;
  const idempotencyKey = faucetClaimIdempotencyKey(account.id, randomUUID());

  const ledgerTxn = await postLedgerTransaction(tx, {
    eventType: "FAUCET_CLAIM",
    idempotencyKey,
    entries: [
      {
        ledgerAccountId: userCash.id,
        amount: faucetAmount,
      },
      {
        ledgerAccountId: systemFunding.id,
        amount: faucetAmount.negated(),
      },
    ],
  });

  await insertFundingEvent(tx, {
    paperAccountId: account.id,
    eventType: "FAUCET_CLAIM",
    amount: faucetAmount,
    idempotencyKey,
    ledgerTransactionId: ledgerTxn.id,
  });

  const nextBalance = fromDbDecimal(account.balance).plus(faucetAmount);

  return applyFaucetClaim(tx, {
    paperAccountId: account.id,
    balance: nextBalance,
    claimedAtUtc: cooldown.claimedAtUtc,
  });
}
