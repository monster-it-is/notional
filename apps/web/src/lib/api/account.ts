import type { AccountResponse, FundingHistoryResponse } from "@notional/contracts";

import { apiRequest } from "./client.ts";

export function getAccount(): Promise<AccountResponse> {
  return apiRequest<AccountResponse>("/api/account");
}

export function initializeAccount(): Promise<AccountResponse> {
  return apiRequest<AccountResponse>("/api/account/initialize", { method: "POST" });
}

export function claimFaucet(): Promise<AccountResponse> {
  return apiRequest<AccountResponse>("/api/account/faucet", { method: "POST" });
}

export function getWalletFunding(params: {
  limit?: number;
  offset?: number;
}): Promise<FundingHistoryResponse> {
  return apiRequest<FundingHistoryResponse>(`/api/account/funding${toQuery(params)}`);
}

function toQuery(params: { limit?: number; offset?: number }): string {
  const search = new URLSearchParams();

  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }

  if (params.offset !== undefined) {
    search.set("offset", String(params.offset));
  }

  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
}
