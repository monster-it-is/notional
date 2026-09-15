import type { CreateOrderRequest, OrderResponse } from "@notional/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { placeOrder } from "../lib/api/orders.ts";
import type { OrderIntent } from "../lib/idempotency.ts";
import { resolveOrderIntent } from "../lib/idempotency.ts";
import { invalidateAfterPlaceOrder } from "../realtime/invalidate.ts";

export const PLACE_ORDER_MUTATION_OPTIONS = {
  retry: false as const,
};

export function usePlaceOrder(): {
  place: (request: CreateOrderRequest) => void;
  retrySameIntent: () => void;
  pending: boolean;
  error: unknown;
  data: OrderResponse | undefined;
  reset: () => void;
} {
  const queryClient = useQueryClient();
  const intentRef = useRef<OrderIntent | null>(null);
  const requestRef = useRef<CreateOrderRequest | null>(null);

  const mutation = useMutation({
    ...PLACE_ORDER_MUTATION_OPTIONS,
    mutationFn: (request: CreateOrderRequest) => {
      const resolved = resolveOrderIntent(intentRef.current, request, () => crypto.randomUUID());
      intentRef.current = resolved.intent;
      requestRef.current = request;
      return placeOrder(request, resolved.intent.key);
    },
    onSuccess: (order) => {
      intentRef.current = null;
      requestRef.current = null;
      invalidateAfterPlaceOrder(queryClient, order.status);
    },
  });

  return {
    place: (request) => {
      mutation.mutate(request);
    },
    retrySameIntent: () => {
      if (!requestRef.current) {
        return;
      }

      mutation.mutate(requestRef.current);
    },
    pending: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    reset: () => {
      mutation.reset();
    },
  };
}
