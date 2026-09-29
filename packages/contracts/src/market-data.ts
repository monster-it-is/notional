export const CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export type Candle = {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

export type CandleListResponse = {
  symbol: string;
  interval: CandleInterval;
  candles: Candle[];
};

export type MarketDataResponse = {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  bestBidPrice: string;
  bestBidQty: string;
  bestAskPrice: string;
  bestAskQty: string;
  fundingRate: string;
  nextFundingTime: number;
  markEventTime: number;
  bookEventTime: number;
};

export type MarketDataUnavailableError = {
  error: "MARKET_DATA_UNAVAILABLE";
};

export type MarketDataStatusResponse = {
  catalogSyncOk: boolean;
  catalogSyncedAt: number | null;
  marketWsConnected: boolean;
  publicWsConnected: boolean;
  readySymbolCount: number;
};
