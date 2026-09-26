import type { OrderResponse } from "@notional/contracts";

export function OrderAcknowledgement({ order }: { order: OrderResponse }) {
  return (
    <p role="status" className="text-sm text-secondary">
      {order.symbol} · {order.type} {order.side} · {order.status}
    </p>
  );
}
