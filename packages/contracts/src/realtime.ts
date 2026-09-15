export const REALTIME_PROTOCOL_VERSION = 1 as const;

export type RealtimeChannel = "market" | "account";

export type PrivateResource =
  | "account"
  | "orders"
  | "positions"
  | "executions"
  | "perpFunding"
  | "walletFunding"
  | "liquidations"
  | "marginSettings";

export type PrivateInvalidateReason =
  | "ORDER_PLACED"
  | "ORDER_FILLED"
  | "ORDER_CANCELLED"
  | "LIMIT_MATCHED"
  | "LIQUIDATION"
  | "FUNDING_SETTLED"
  | "FAUCET_CLAIMED"
  | "MARGIN_SETTINGS_CHANGED"
  | "ACCOUNT_INITIALIZED";

export type MarketSubscribeMessage = {
  type: "market.subscribe";
  symbol: string;
};

export type MarketUnsubscribeMessage = {
  type: "market.unsubscribe";
  symbol: string;
};

export type PingMessage = {
  type: "ping";
  ts?: number;
};

export type RealtimeClientMessage =
  | MarketSubscribeMessage
  | MarketUnsubscribeMessage
  | PingMessage;

export type HelloMessage = {
  type: "hello";
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  channel: RealtimeChannel;
  serverTime: string;
};

export type MarketBboMessage = {
  type: "market.bbo";
  symbol: string;
  bestBidPrice: string;
  bestBidQty: string;
  bestAskPrice: string;
  bestAskQty: string;
  bookEventTime: number;
};

export type MarketMarkMessage = {
  type: "market.mark";
  symbol: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingTime: number;
  markEventTime: number;
};

export type PrivateInvalidateMessage = {
  type: "private.invalidate";
  eventId: string;
  occurredAt: string;
  resources: PrivateResource[];
  reason: PrivateInvalidateReason;
};

export type PongMessage = {
  type: "pong";
  ts?: number;
  serverTime: string;
};

export type RealtimeErrorMessage = {
  type: "error";
  code: string;
  message: string;
};

export type RealtimeServerMessage =
  | HelloMessage
  | MarketBboMessage
  | MarketMarkMessage
  | PrivateInvalidateMessage
  | PongMessage
  | RealtimeErrorMessage;
