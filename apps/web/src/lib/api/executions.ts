import type { ExecutionListResponse } from "@notional/contracts";

import { apiRequest } from "./client.ts";

export function listExecutions(params: {
  limit?: number;
  offset?: number;
  symbol?: string;
  orderId?: string;
}): Promise<ExecutionListResponse> {
  const search = new URLSearchParams();

  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }

  if (params.offset !== undefined) {
    search.set("offset", String(params.offset));
  }

  if (params.symbol) {
    search.set("symbol", params.symbol);
  }

  if (params.orderId) {
    search.set("orderId", params.orderId);
  }

  const query = search.toString();
  return apiRequest<ExecutionListResponse>(
    `/api/executions${query.length > 0 ? `?${query}` : ""}`,
  );
}
