import type { Time } from "lightweight-charts";
import { describe, expect, it, vi } from "vitest";

import { DrawingPrimitive } from "./DrawingPrimitive.ts";
import { parseDrawingHit } from "./hit.ts";
import { DEFAULT_DRAWING_COLORS, type ChartDrawing } from "./types.ts";

const TIME_A = 1_000 as Time;
const TIME_B = 2_000 as Time;
const PRICE_A = 100;
const PRICE_B = 180;
const OFFSCREEN_TIME = 9_999 as Time;
const OFFSCREEN_PRICE = 12_000;

function createCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "",
    globalAlpha: 1,
  };
}

function createTarget(ctx: ReturnType<typeof createCtx>, width = 400, height = 300) {
  return {
    useBitmapCoordinateSpace(fn: (scope: {
      context: ReturnType<typeof createCtx>;
      mediaSize: { width: number; height: number };
      bitmapSize: { width: number; height: number };
      horizontalPixelRatio: number;
      verticalPixelRatio: number;
    }) => void) {
      fn({
        context: ctx,
        mediaSize: { width, height },
        bitmapSize: { width: width * 2, height: height * 2 },
        horizontalPixelRatio: 2,
        verticalPixelRatio: 2,
      });
    },
    useMediaCoordinateSpace() {
      throw new Error("renderer must not mix media space into bitmap strokes");
    },
  };
}

function attachPrimitive() {
  const requestUpdate = vi.fn();
  const timeToCoordinate = vi.fn((time: unknown) => {
    if (time === OFFSCREEN_TIME) {
      return null;
    }

    if (time === TIME_A) {
      return 10;
    }

    if (time === TIME_B) {
      return 50;
    }

    return typeof time === "number" ? time / 100 : null;
  });
  const coordinateToTime = vi.fn((x: number) => {
    if (x < 0) {
      return null;
    }

    return x * 100;
  });
  const priceToCoordinate = vi.fn((price: number) => {
    if (price === OFFSCREEN_PRICE) {
      return null;
    }

    if (price === PRICE_A) {
      return 40;
    }

    if (price === PRICE_B) {
      return 80;
    }

    return price < 0 ? null : 200 - price;
  });
  const coordinateToPrice = vi.fn((y: number) => {
    if (y < 0) {
      return null;
    }

    return 200 - y;
  });
  const chart = {
    timeScale: () => ({
      timeToCoordinate,
      coordinateToTime,
    }),
  };
  const series = {
    priceToCoordinate,
    coordinateToPrice,
  };
  const primitive = new DrawingPrimitive();
  primitive.attached({
    chart: chart as never,
    series: series as never,
    requestUpdate,
    horzScaleBehavior: {} as never,
  });

  return {
    primitive,
    requestUpdate,
    timeToCoordinate,
    priceToCoordinate,
    chart,
    series,
  };
}

function trend(id: string, a = { time: TIME_A, price: PRICE_A }, b = { time: TIME_B, price: PRICE_B }): ChartDrawing {
  return {
    id,
    type: "trend-line",
    symbol: "BTCUSDT",
    a,
    b,
  };
}

function horizontal(id: string, price = PRICE_A): ChartDrawing {
  return {
    id,
    type: "horizontal-line",
    symbol: "BTCUSDT",
    price,
  };
}

function render(primitive: DrawingPrimitive) {
  const ctx = createCtx();
  primitive.updateAllViews();
  const renderer = primitive.paneViews()[0]?.renderer();
  renderer?.draw(createTarget(ctx) as never);
  return ctx;
}

describe("DrawingPrimitive", () => {
  it("attaches once and setState requests a redraw without reattaching", () => {
    const { primitive, requestUpdate } = attachPrimitive();
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    primitive.setState({
      drawings: [trend("t1")],
      colors: DEFAULT_DRAWING_COLORS,
    });
    expect(requestUpdate).toHaveBeenCalledTimes(2);
    primitive.setState({ selectedId: "t1" });
    expect(requestUpdate).toHaveBeenCalledTimes(3);
    expect(primitive.getState().drawings).toHaveLength(1);
    expect(primitive.getState().selectedId).toBe("t1");
  });

  it("clears chart references on detach", () => {
    const { primitive, requestUpdate } = attachPrimitive();
    requestUpdate.mockClear();
    primitive.detached();
    primitive.setState({ drawings: [trend("t1")] });
    expect(requestUpdate).not.toHaveBeenCalled();
    expect(primitive.hitTest(10, 40)).toBeNull();
  });

  it("draws a trend segment using converted bitmap coordinates", () => {
    const { primitive } = attachPrimitive();
    primitive.setState({ drawings: [trend("t1")] });
    const ctx = render(primitive);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(20, 80);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 160);
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it("draws a horizontal line across the pane width", () => {
    const { primitive } = attachPrimitive();
    primitive.setState({ drawings: [horizontal("h1", PRICE_A)] });
    const ctx = render(primitive);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 80);
    expect(ctx.lineTo).toHaveBeenCalledWith(800, 80);
  });

  it("draws selected trend handles and a stronger stroke", () => {
    const { primitive } = attachPrimitive();
    primitive.setState({ drawings: [trend("t1")], selectedId: "t1" });
    const ctx = render(primitive);
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(ctx.lineWidth).toBeGreaterThan(1);
  });

  it("skips drawings whose converted coordinates are null", () => {
    const { primitive } = attachPrimitive();
    primitive.setState({
      drawings: [
        trend("off-time", { time: OFFSCREEN_TIME, price: PRICE_A }, { time: TIME_B, price: PRICE_B }),
        horizontal("off-price", OFFSCREEN_PRICE),
      ],
    });
    const ctx = render(primitive);
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(primitive.hitTest(10, 40)).toBeNull();
  });

  it("returns the drawing id from hitTest and prefers the latest overlap", () => {
    const { primitive } = attachPrimitive();
    primitive.setState({
      drawings: [horizontal("older", PRICE_A), horizontal("newer", PRICE_A)],
    });
    const hit = primitive.hitTest(20, 40);
    expect(parseDrawingHit(hit?.externalId)?.drawingId).toBe("newer");
    expect(hit?.cursorStyle).toBe("pointer");
    expect(hit?.zOrder).toBe("top");
  });

  it("hits a trend segment near the line and misses outside the tolerance", () => {
    const { primitive } = attachPrimitive();
    primitive.setState({ drawings: [trend("t1")] });
    expect(parseDrawingHit(primitive.hitTest(10, 40)?.externalId)?.drawingId).toBe("t1");
    expect(primitive.hitTest(10, 49)).toBeNull();
  });

  it("exposes selected trend endpoints before the body and hides them when unselected", () => {
    const { primitive } = attachPrimitive();
    primitive.setState({ drawings: [trend("t1")] });
    expect(parseDrawingHit(primitive.hitTest(10, 40)?.externalId)).toEqual({
      drawingId: "t1",
      region: "trend-body",
    });
    expect(primitive.hitTest(10, 40)?.cursorStyle).toBe("pointer");
    primitive.setState({ selectedId: "t1" });
    expect(parseDrawingHit(primitive.hitTest(10, 40)?.externalId)).toEqual({
      drawingId: "t1",
      region: "trend-a",
    });
    expect(primitive.hitTest(10, 40)?.cursorStyle).toBe("pointer");
    expect(parseDrawingHit(primitive.hitTest(50, 80)?.externalId)).toEqual({
      drawingId: "t1",
      region: "trend-b",
    });
    expect(parseDrawingHit(primitive.hitTest(30, 60)?.externalId)).toEqual({
      drawingId: "t1",
      region: "trend-body",
    });
    expect(primitive.hitTest(30, 60)?.cursorStyle).toBe("grab");
  });

  it("uses a stronger selected horizontal stroke and a vertical resize cursor", () => {
    const { primitive } = attachPrimitive();
    primitive.setState({ drawings: [horizontal("h1", PRICE_A)], selectedId: "h1" });
    const ctx = render(primitive);
    expect(ctx.lineWidth).toBeGreaterThan(2);
    expect(parseDrawingHit(primitive.hitTest(20, 40)?.externalId)).toEqual({
      drawingId: "h1",
      region: "horizontal",
    });
    expect(primitive.hitTest(20, 40)?.cursorStyle).toBe("ns-resize");
  });

  it("does not hit-test draft geometry", () => {
    const { primitive } = attachPrimitive();
    primitive.setState({
      draft: {
        type: "trend-line",
        a: { time: TIME_A, price: PRICE_A },
        b: { time: TIME_B, price: PRICE_B },
      },
    });
    expect(primitive.hitTest(10, 40)).toBeNull();
  });

  it("updates theme colors without reattaching", () => {
    const { primitive, requestUpdate, series } = attachPrimitive();
    const attachedSeries = series;
    requestUpdate.mockClear();
    primitive.setState({
      colors: { line: "#111111", selected: "#222222", handle: "#333333" },
    });
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    expect(primitive.getState().colors.line).toBe("#111111");
    primitive.updateAllViews();
    expect(primitive.paneViews()).toHaveLength(1);
    expect(attachedSeries).toBe(series);
  });
});
