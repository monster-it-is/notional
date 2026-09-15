import type { CreateOrderRequest } from "@notional/contracts";

export type OrderIntent = {
  key: string;
  fingerprint: string;
};

export function orderFingerprint(request: CreateOrderRequest): string {
  return JSON.stringify({
    type: request.type,
    symbol: request.symbol,
    side: request.side,
    quantity: request.quantity,
    limitPrice: request.type === "LIMIT" ? request.limitPrice : null,
    reduceOnly: request.reduceOnly ?? false,
  });
}

export function resolveOrderIntent(
  current: OrderIntent | null,
  request: CreateOrderRequest,
  createKey: () => string,
): { intent: OrderIntent; reused: boolean } {
  const fingerprint = orderFingerprint(request);

  if (current && current.fingerprint === fingerprint) {
    return { intent: current, reused: true };
  }

  return {
    intent: {
      key: createKey(),
      fingerprint,
    },
    reused: false,
  };
}
