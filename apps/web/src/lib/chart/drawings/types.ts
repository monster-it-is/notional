import type { Time } from "lightweight-charts";

/**
 * Visual UI geometry for chart drawings.
 *
 * Values are render-only coordinates from Lightweight Charts
 * (`coordinateToTime` / `timeToCoordinate` / `coordinateToPrice` /
 * `priceToCoordinate`). They must never enter orders, balances, margin, PnL,
 * canonical candles, indicator Decimal math, API payloads, or `packages/trading`.
 */
export type DrawingPoint = {
  time: Time;
  price: number;
};

export type DrawingTool = "select" | "trend-line" | "horizontal-line";

export type TrendLineDrawing = {
  id: string;
  type: "trend-line";
  symbol: string;
  a: DrawingPoint;
  b: DrawingPoint;
};

export type HorizontalLineDrawing = {
  id: string;
  type: "horizontal-line";
  symbol: string;
  price: number;
};

export type ChartDrawing = TrendLineDrawing | HorizontalLineDrawing;

export type TrendLineDraft = {
  type: "trend-line";
  a: DrawingPoint;
  b: DrawingPoint | null;
};

export type HorizontalLineDraft = {
  type: "horizontal-line";
  price: number;
};

export type DrawingDraft = TrendLineDraft | HorizontalLineDraft;

export type DrawingColors = {
  line: string;
  selected: string;
  handle: string;
};

export type DrawingPrimitiveState = {
  drawings: readonly ChartDrawing[];
  draft: DrawingDraft | null;
  selectedId: string | null;
  hoveredId: string | null;
  colors: DrawingColors;
};

export const DEFAULT_DRAWING_COLORS: DrawingColors = {
  line: "#c4a35a",
  selected: "#e8c36a",
  handle: "#f0d78c",
};

export const EMPTY_DRAWING_STATE: DrawingPrimitiveState = {
  drawings: [],
  draft: null,
  selectedId: null,
  hoveredId: null,
  colors: DEFAULT_DRAWING_COLORS,
};

export function createDrawingId(): string {
  return crypto.randomUUID();
}

export function drawingToolLabel(tool: DrawingTool): string {
  if (tool === "trend-line") {
    return "Trend Line";
  }

  if (tool === "horizontal-line") {
    return "Horizontal Line";
  }

  return "Select";
}
