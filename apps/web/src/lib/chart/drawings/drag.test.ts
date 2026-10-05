import type { Time } from "lightweight-charts";
import { describe, expect, it, vi } from "vitest";

import { previewDrawingDrag, startDrawingDrag } from "./drag.ts";
import type { HorizontalLineDrawing, TrendLineDrawing } from "./types.ts";

const TIME_A = 1_000 as Time;
const TIME_B = 2_000 as Time;

function converters() {
  const timeToCoordinate = vi.fn((time: unknown) => (typeof time === "number" ? time / 100 : null));
  const coordinateToTime = vi.fn((x: number) => (x < 0 ? null : x * 100));
  const priceToCoordinate = vi.fn((price: number) => (price < 0 ? null : 200 - price));
  const coordinateToPrice = vi.fn((y: number) => (y < 0 ? null : 200 - y));
  const chart = {
    timeScale: () => ({ timeToCoordinate, coordinateToTime }),
  };
  const series = { priceToCoordinate, coordinateToPrice };
  return {
    chart: chart as never,
    series: series as never,
    coordinateToTime,
    coordinateToPrice,
  };
}

function trend(): TrendLineDrawing {
  return {
    id: "t1",
    type: "trend-line",
    symbol: "BTCUSDT",
    a: { time: TIME_A, price: 100 },
    b: { time: TIME_B, price: 180 },
  };
}

function horizontal(): HorizontalLineDrawing {
  return {
    id: "h1",
    type: "horizontal-line",
    symbol: "BTCUSDT",
    price: 100,
  };
}

describe("drawing drag preview", () => {
  it("moves only endpoint A", () => {
    const { chart, series } = converters();
    const original = trend();
    const drag = startDrawingDrag(original, "trend-a", { x: 10, y: 100 }, chart, series);
    expect(drag?.type).toBe("trend-a");
    expect(previewDrawingDrag(drag!, { x: 30, y: 80 }, chart, series)).toEqual({
      ...original,
      a: { time: 3_000 as Time, price: 120 },
    });
  });

  it("moves only endpoint B", () => {
    const { chart, series } = converters();
    const original = trend();
    const drag = startDrawingDrag(original, "trend-b", { x: 20, y: 20 }, chart, series);
    expect(previewDrawingDrag(drag!, { x: 40, y: 40 }, chart, series)).toEqual({
      ...original,
      b: { time: 4_000 as Time, price: 160 },
    });
  });

  it("moves the body from drag-start anchors and preserves relative shape", () => {
    const { chart, series } = converters();
    const original = trend();
    const drag = startDrawingDrag(original, "trend-body", { x: 15, y: 60 }, chart, series);
    expect(drag?.type).toBe("trend-body");
    const first = previewDrawingDrag(drag!, { x: 25, y: 50 }, chart, series);
    expect(first).toEqual({
      ...original,
      a: { time: 2_000 as Time, price: 110 },
      b: { time: 3_000 as Time, price: 190 },
    });

    const second = previewDrawingDrag(drag!, { x: 35, y: 40 }, chart, series);
    expect(second).toEqual({
      ...original,
      a: { time: 3_000 as Time, price: 120 },
      b: { time: 4_000 as Time, price: 200 },
    });
    expect(second && second.type === "trend-line" ? second.b.price - second.a.price : null).toBe(80);
  });

  it("does not compound from the previous preview across pointer moves", () => {
    const { chart, series } = converters();
    const original = trend();
    const drag = startDrawingDrag(original, "trend-body", { x: 15, y: 60 }, chart, series)!;
    const first = previewDrawingDrag(drag, { x: 25, y: 50 }, chart, series);
    const second = previewDrawingDrag(drag, { x: 35, y: 40 }, chart, series);
    expect(first).not.toEqual(second);
    expect(previewDrawingDrag(drag, { x: 25, y: 50 }, chart, series)).toEqual(first);
  });

  it("keeps the last valid preview when a converted endpoint is null", () => {
    const { chart, series } = converters();
    const original = trend();
    const drag = startDrawingDrag(original, "trend-a", { x: 10, y: 100 }, chart, series)!;
    expect(previewDrawingDrag(drag, { x: -1, y: 80 }, chart, series)).toBeNull();
    expect(previewDrawingDrag(drag, { x: 12, y: -4 }, chart, series)).toBeNull();
  });

  it("updates a horizontal line from pointer y only", () => {
    const { chart, series } = converters();
    const original = horizontal();
    const drag = startDrawingDrag(original, "horizontal", { x: 10, y: 100 }, chart, series);
    expect(previewDrawingDrag(drag!, { x: 80, y: 60 }, chart, series)).toEqual({
      ...original,
      price: 140,
    });
    expect(previewDrawingDrag(drag!, { x: 80, y: -1 }, chart, series)).toBeNull();
  });
});
