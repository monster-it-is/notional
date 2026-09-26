import type { MarginMode } from "./margin.js";

export type PositionResponse = {
  symbol: string;
  quantity: string;
  entryPrice: string;
  markPrice: string | null;
  unrealizedPnl: string | null;
  cumulativeRealizedPnl: string;
  marginMode: MarginMode;
  leverage: number;
  updatedAt: string;
};

export type PositionListResponse = {
  positions: PositionResponse[];
};

export type PositionNotFoundError = {
  error: "POSITION_NOT_FOUND";
};
