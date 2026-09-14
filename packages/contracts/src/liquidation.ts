import type { MarginMode } from "./margin.js";

export type LiquidationResponse = {
  id: string;
  marginMode: MarginMode;
  symbol: string | null;
  equity: string;
  maintenanceMargin: string;
  createdAt: string;
};

export type LiquidationListResponse = {
  liquidations: LiquidationResponse[];
};
