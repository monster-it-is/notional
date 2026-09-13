export { db, pool } from "./client.js";
export type { FinancialExecutor, FinancialTransaction } from "./executor.js";
export {
  readFaucetCooldownState,
} from "./faucet.js";
export type { FaucetCooldownState } from "./faucet.js";
export {
  findSignupAllocationFundingEvent,
  insertFundingEvent,
  listFundingEventsByPaperAccountId,
} from "./funding-event.js";
export type { FundingEvent } from "./funding-event.js";
export { checkDatabaseHealth } from "./health.js";
export { postLedgerTransaction } from "./ledger.js";
export type { FinancialEventType, LedgerEntry, LedgerTransaction } from "./ledger.js";
export {
  ensureSystemVirtualFundingAccount,
  ensureUserCashLedgerAccount,
} from "./ledger-account.js";
export type { LedgerAccount } from "./ledger-account.js";
export {
  faucetClaimIdempotencyKey,
  fromDbDecimal,
  MoneyDecimal,
  parseConfiguredMoney,
  SIGNUP_ALLOCATION_AMOUNT,
  signupAllocationIdempotencyKey,
  toDbDecimal,
} from "./money.js";
export {
  findInstrumentById,
  findInstrumentBySymbol,
  listActiveInstruments,
  upsertInstrumentBySymbol,
} from "./instrument.js";
export type {
  Instrument,
  InstrumentStatus,
  UpsertInstrumentInput,
} from "./instrument.js";
export {
  applyFaucetClaim,
  ensurePaperAccount,
  findPaperAccountByUserId,
  lockPaperAccountByUserId,
  updatePaperAccountBalance,
} from "./paper-account.js";
export type { PaperAccount } from "./paper-account.js";
export * from "./schema/index.js";
