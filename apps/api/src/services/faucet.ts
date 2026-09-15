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
import { FundingDataUnavailableError, settleDueFundingForAccountInTx } from "./funding-settlement.js";
import { faucetEffect, safeOnPrivateCommitted, type CommittedPrivateEffect } from "../realtime/effects.js";
import { silentLogger, type Logger } from "../market-data/types.js";

export class FaucetClaimError extends Error {
  readonly code:
    | "ACCOUNT_NOT_INITIALIZED"
    | "ACCOUNT_SUSPENDED"
    | "FAUCET_COOLDOWN"
    | "FUNDING_DATA_UNAVAILABLE";
  readonly nextClaimAt: Date | null;

  constructor(
    code:
      | "ACCOUNT_NOT_INITIALIZED"
      | "ACCOUNT_SUSPENDED"
      | "FAUCET_COOLDOWN"
      | "FUNDING_DATA_UNAVAILABLE",
    nextClaimAt: Date | null = null,
  ) {
    super(code);
    this.name = "FaucetClaimError";
    this.code = code;
    this.nextClaimAt = nextClaimAt;
  }
}

export async function claimFaucet(
  userId: string,
  onPrivateCommitted?: (effect: CommittedPrivateEffect) => void,
  logger: Logger = silentLogger,
): Promise<PaperAccount> {
  const result = await db.transaction((tx) => claimFaucetInTx(tx, userId));
  safeOnPrivateCommitted(
    onPrivateCommitted,
    faucetEffect({
      paperAccountId: result.account.id,
      settledFunding: result.settledFunding,
    }),
    logger,
  );
  return result.account;
}

export async function claimFaucetInTx(
  tx: FinancialTransaction,
  userId: string,
): Promise<{ account: PaperAccount; settledFunding: boolean }> {
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

  let funded;
  try {
    funded = await settleDueFundingForAccountInTx(tx, {
      accountId: account.id,
      extraInstrumentIds: [],
    });
  } catch (error) {
    if (error instanceof FundingDataUnavailableError) {
      throw new FaucetClaimError("FUNDING_DATA_UNAVAILABLE");
    }
    throw error;
  }

  const cooldown = await readFaucetCooldownState(tx, funded.account.id);

  if (!cooldown.eligible) {
    if (!cooldown.nextClaimAt) {
      throw new Error("FAUCET_COOLDOWN missing nextClaimAt");
    }

    throw new FaucetClaimError("FAUCET_COOLDOWN", cooldown.nextClaimAt);
  }

  const userCash = await ensureUserCashLedgerAccount(tx, funded.account.id);
  const systemFunding = await ensureSystemVirtualFundingAccount(tx);
  const faucetAmount = env.FAUCET_AMOUNT;
  const idempotencyKey = faucetClaimIdempotencyKey(funded.account.id, randomUUID());

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
    paperAccountId: funded.account.id,
    eventType: "FAUCET_CLAIM",
    amount: faucetAmount,
    idempotencyKey,
    ledgerTransactionId: ledgerTxn.id,
  });

  const nextBalance = fromDbDecimal(funded.account.balance).plus(faucetAmount);

  const updated = await applyFaucetClaim(tx, {
    paperAccountId: funded.account.id,
    balance: nextBalance,
    claimedAtUtc: cooldown.claimedAtUtc,
  });

  return {
    account: updated,
    settledFunding: funded.settledBatches.length > 0,
  };
}
