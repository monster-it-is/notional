import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";

import { translateTrendBody, type ScreenPoint } from "./geometry.ts";
import type { DrawingHitRegion } from "./hit.ts";
import { projectDrawingPoint, resolveDrawingPoint, resolveDrawingPrice } from "./point.ts";
import type { ChartDrawing, HorizontalLineDrawing, TrendLineDrawing } from "./types.ts";

export type DrawingDrag =
  | {
      type: "trend-a";
      drawingId: string;
      original: TrendLineDrawing;
    }
  | {
      type: "trend-b";
      drawingId: string;
      original: TrendLineDrawing;
    }
  | {
      type: "trend-body";
      drawingId: string;
      original: TrendLineDrawing;
      startPointer: ScreenPoint;
      startA: ScreenPoint;
      startB: ScreenPoint;
    }
  | {
      type: "horizontal";
      drawingId: string;
      original: HorizontalLineDrawing;
    };

export function startDrawingDrag(
  drawing: ChartDrawing,
  region: DrawingHitRegion,
  pointer: ScreenPoint,
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
): DrawingDrag | null {
  if (drawing.type === "trend-line") {
    if (region === "trend-a") {
      return { type: "trend-a", drawingId: drawing.id, original: drawing };
    }

    if (region === "trend-b") {
      return { type: "trend-b", drawingId: drawing.id, original: drawing };
    }

    if (region === "trend-body") {
      const startA = projectDrawingPoint(chart, series, drawing.a);
      const startB = projectDrawingPoint(chart, series, drawing.b);

      if (!startA || !startB) {
        return null;
      }

      return {
        type: "trend-body",
        drawingId: drawing.id,
        original: drawing,
        startPointer: pointer,
        startA,
        startB,
      };
    }

    return null;
  }

  if (region !== "horizontal") {
    return null;
  }

  return { type: "horizontal", drawingId: drawing.id, original: drawing };
}

export function previewDrawingDrag(
  drag: DrawingDrag,
  pointer: ScreenPoint,
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
): ChartDrawing | null {
  if (drag.type === "trend-a" || drag.type === "trend-b") {
    const point = resolveDrawingPoint(chart, series, pointer);

    if (!point) {
      return null;
    }

    return drag.type === "trend-a"
      ? { ...drag.original, a: point }
      : { ...drag.original, b: point };
  }

  if (drag.type === "trend-body") {
    const moved = translateTrendBody(drag.startA, drag.startB, drag.startPointer, pointer);
    const a = resolveDrawingPoint(chart, series, moved.a);
    const b = resolveDrawingPoint(chart, series, moved.b);

    if (!a || !b) {
      return null;
    }

    return { ...drag.original, a, b };
  }

  const price = resolveDrawingPrice(series, pointer.y);

  if (price === null) {
    return null;
  }

  return { ...drag.original, price };
}

export function replaceDrawing(
  drawings: readonly ChartDrawing[],
  next: ChartDrawing,
): ChartDrawing[] {
  return drawings.map((drawing) => (drawing.id === next.id ? next : drawing));
}
