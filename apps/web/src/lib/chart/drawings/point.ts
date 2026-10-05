import type { IChartApi, ISeriesApi, MouseEventParams, SeriesType } from "lightweight-charts";

import type { ScreenPoint } from "./geometry.ts";
import { parseDrawingHit } from "./hit.ts";
import type { DrawingPoint } from "./types.ts";

/**
 * Convert a pointer location to visual drawing anchors.
 * Fail closed when either Lightweight Charts converter returns null/undefined.
 */
export function resolveDrawingPoint(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  point: { x: number; y: number },
): DrawingPoint | null {
  const time = chart.timeScale().coordinateToTime(point.x);
  const price = resolveDrawingPrice(series, point.y);

  if (time === null || time === undefined || price === null) {
    return null;
  }

  return { time, price };
}

export function resolveDrawingPrice(
  series: ISeriesApi<SeriesType>,
  y: number,
): number | null {
  const price = series.coordinateToPrice(y);

  if (price === null || price === undefined || !Number.isFinite(price)) {
    return null;
  }

  return price;
}

export function projectDrawingPoint(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  point: DrawingPoint,
): ScreenPoint | null {
  const x = chart.timeScale().timeToCoordinate(point.time);
  const y = series.priceToCoordinate(point.price);

  if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

export function chartPointFromPointer(host: HTMLElement, event: PointerEvent): ScreenPoint {
  const rect = host.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

export function readHoveredDrawingId(param: MouseEventParams): string | null {
  return readHoveredDrawingHit(param)?.drawingId ?? null;
}

export function readHoveredDrawingHit(param: MouseEventParams) {
  if (param.paneIndex !== 0) {
    return null;
  }

  const info = param.hoveredInfo;

  if (!info) {
    return null;
  }

  if (info.sourceKind !== undefined && info.sourceKind !== "series-primitive") {
    return null;
  }

  return typeof info.objectId === "string" ? parseDrawingHit(info.objectId) : null;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;

  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  return target.isContentEditable;
}
