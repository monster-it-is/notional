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
