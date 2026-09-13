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
