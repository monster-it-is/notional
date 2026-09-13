export type OrderSide = "BUY" | "SELL";

export type OrderType = "MARKET" | "LIMIT";

export type OrderStatus = "OPEN" | "FILLED" | "CANCELLED";

export type OrderResponse = {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  limitPrice: string | null;
  reduceOnly: boolean;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
};

export type OrderListResponse = {
  orders: OrderResponse[];
};

export type CreateOrderRequest =
  | {
      type: "MARKET";
      symbol: string;
      side: OrderSide;
      quantity: string;
      reduceOnly?: boolean;
    }
  | {
      type: "LIMIT";
      symbol: string;
      side: OrderSide;
      quantity: string;
      limitPrice: string;
      reduceOnly?: boolean;
    };

export type OrderNotFoundError = {
  error: "ORDER_NOT_FOUND";
};

export type InvalidQueryError = {
  error: "INVALID_QUERY";
};

export type InvalidOrderReason = "INVALID_QUANTITY" | "INVALID_PRICE" | "MIN_NOTIONAL";

export type InvalidOrderError = {
  error: "INVALID_ORDER";
  reason: InvalidOrderReason;
};

export type InstrumentInactiveError = {
  error: "INSTRUMENT_INACTIVE";
};

export type IdempotencyKeyRequiredError = {
  error: "IDEMPOTENCY_KEY_REQUIRED";
};

export type IdempotencyKeyInvalidError = {
  error: "IDEMPOTENCY_KEY_INVALID";
};

export type IdempotencyKeyReusedError = {
  error: "IDEMPOTENCY_KEY_REUSED";
};

export type OrderNotCancellableError = {
  error: "ORDER_NOT_CANCELLABLE";
};
