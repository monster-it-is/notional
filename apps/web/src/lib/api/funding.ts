import type { PerpFundingHistoryResponse } from "@notional/contracts";

import { apiRequest } from "./client.ts";

export function listPerpFunding(params: {
  limit?: number;
  offset?: number;
}): Promise<PerpFundingHistoryResponse> {
  const search = new URLSearchParams();

  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }

  if (params.offset !== undefined) {
    search.set("offset", String(params.offset));
  }

  const query = search.toString();
  return apiRequest<PerpFundingHistoryResponse>(
    `/api/funding${query.length > 0 ? `?${query}` : ""}`,
  );
}
