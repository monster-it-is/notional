export type AccountCurrency = "USDT";

export type AccountStatus = "ACTIVE" | "SUSPENDED";

export type AccountResponse = {
  id: string;
  userId: string;
  currency: AccountCurrency;
  balance: string;
  status: AccountStatus;
  lastFaucetClaimAt: string | null;
  createdAt: string;
};

export type AccountNotInitializedError = {
  error: "ACCOUNT_NOT_INITIALIZED";
};

export type AccountSuspendedError = {
  error: "ACCOUNT_SUSPENDED";
};

export type FaucetCooldownError = {
  error: "FAUCET_COOLDOWN";
  nextClaimAt: string;
};

export type FundingEventType = "SIGNUP_ALLOCATION" | "FAUCET_CLAIM";

export type FundingEventResponse = {
  id: string;
  type: FundingEventType;
  amount: string;
  currency: AccountCurrency;
  createdAt: string;
};

export type FundingHistoryResponse = {
  events: FundingEventResponse[];
};
