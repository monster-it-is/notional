import type { OrderSide, OrderType } from "./order.js";

export type ExecutionResponse = {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: string;
  price: string;
  executedAt: string;
};

export type ExecutionListResponse = {
  executions: ExecutionResponse[];
};

export type ExecutionNotFoundError = {
  error: "EXECUTION_NOT_FOUND";
};
