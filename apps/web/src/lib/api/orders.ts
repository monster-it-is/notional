import type {
  CreateOrderRequest,
  OrderListResponse,
  OrderResponse,
  OrderStatus,
} from "@notional/contracts";
import { IDEMPOTENCY_KEY_HEADER } from "@notional/contracts";

import { apiRequest } from "./client.ts";

export function listOrders(params: {
  limit?: number;
  offset?: number;
  status?: OrderStatus;
  symbol?: string;
}): Promise<OrderListResponse> {
  const search = new URLSearchParams();

  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }

  if (params.offset !== undefined) {
    search.set("offset", String(params.offset));
  }

  if (params.status) {
    search.set("status", params.status);
  }

  if (params.symbol) {
    search.set("symbol", params.symbol);
  }

  const query = search.toString();
  return apiRequest<OrderListResponse>(`/api/orders${query.length > 0 ? `?${query}` : ""}`);
}

export function placeOrder(
  body: CreateOrderRequest,
  idempotencyKey: string,
): Promise<OrderResponse> {
  return apiRequest<OrderResponse>("/api/orders", {
    method: "POST",
    body,
    headers: {
      [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    },
  });
}

export function cancelOrder(id: string): Promise<OrderResponse> {
  return apiRequest<OrderResponse>(`/api/orders/${id}/cancel`, { method: "POST" });
}
