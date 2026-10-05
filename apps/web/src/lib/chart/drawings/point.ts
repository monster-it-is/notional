import type { IChartApi, ISeriesApi, MouseEventParams, SeriesType } from "lightweight-charts";

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
  const price = series.coordinateToPrice(point.y);

  if (time === null || time === undefined || price === null || price === undefined) {
    return null;
  }

  if (!Number.isFinite(price)) {
    return null;
  }

  return { time, price };
}

export function readHoveredDrawingId(param: MouseEventParams): string | null {
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

  return typeof info.objectId === "string" && info.objectId.length > 0 ? info.objectId : null;
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
