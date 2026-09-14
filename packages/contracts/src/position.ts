export type PositionResponse = {
  symbol: string;
  quantity: string;
  entryPrice: string;
  cumulativeRealizedPnl: string;
  updatedAt: string;
};

export type PositionListResponse = {
  positions: PositionResponse[];
};

export type PositionNotFoundError = {
  error: "POSITION_NOT_FOUND";
};
