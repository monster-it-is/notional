import type { LiquidationListResponse } from "@notional/contracts";

import { apiRequest } from "./client.ts";

export function listLiquidations(params: {
  limit?: number;
  offset?: number;
}): Promise<LiquidationListResponse> {
  const search = new URLSearchParams();

  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }

  if (params.offset !== undefined) {
    search.set("offset", String(params.offset));
  }

  const query = search.toString();
  return apiRequest<LiquidationListResponse>(
    `/api/liquidations${query.length > 0 ? `?${query}` : ""}`,
  );
}
