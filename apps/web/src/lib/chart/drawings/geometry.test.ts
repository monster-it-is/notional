import { describe, expect, it } from "vitest";

import {
  DRAWING_ENDPOINT_HIT_TOLERANCE_PX,
  DRAWING_HIT_TOLERANCE_PX,
  hitsHorizontalLine,
  hitsTrendEndpoint,
  hitsTrendSegment,
  pointDistance,
  pointToSegmentDistance,
  translateTrendBody,
} from "./geometry.ts";

describe("drawing geometry", () => {
  it("measures the shortest distance from a point to a finite segment", () => {
    expect(pointToSegmentDistance(0, 1, 0, 0, 4, 0)).toBe(1);
    expect(pointToSegmentDistance(2, 0, 0, 0, 4, 0)).toBe(0);
    expect(pointToSegmentDistance(-2, 0, 0, 0, 4, 0)).toBe(2);
    expect(pointToSegmentDistance(6, 0, 0, 0, 4, 0)).toBe(2);
  });

  it("treats reversed endpoints as the same segment", () => {
    expect(pointToSegmentDistance(1, 3, 0, 0, 4, 0)).toBe(
      pointToSegmentDistance(1, 3, 4, 0, 0, 0),
    );
  });

  it("treats a zero-length trend as a point", () => {
    expect(pointToSegmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
    expect(hitsTrendSegment(3, 4, 0, 0, 0, 0, 5)).toBe(true);
    expect(hitsTrendSegment(3, 4, 0, 0, 0, 0, 4)).toBe(false);
  });

  it("hits inside the default CSS-pixel tolerance and misses outside it", () => {
    expect(hitsTrendSegment(0, DRAWING_HIT_TOLERANCE_PX, 0, 0, 10, 0)).toBe(true);
    expect(hitsTrendSegment(0, DRAWING_HIT_TOLERANCE_PX + 0.5, 0, 0, 10, 0)).toBe(false);
  });

  it("hits a horizontal line by vertical distance", () => {
    expect(hitsHorizontalLine(50, 55)).toBe(true);
    expect(hitsHorizontalLine(50, 50 + DRAWING_HIT_TOLERANCE_PX)).toBe(true);
    expect(hitsHorizontalLine(50, 50 + DRAWING_HIT_TOLERANCE_PX + 1)).toBe(false);
  });

  it("does not hit drawings with null or non-finite coordinates", () => {
    expect(hitsTrendSegment(0, 0, null, 0, 4, 0)).toBe(false);
    expect(hitsTrendSegment(0, 0, 0, null, 4, 0)).toBe(false);
    expect(hitsTrendSegment(0, 0, 0, 0, null, 0)).toBe(false);
    expect(hitsTrendSegment(0, 0, 0, 0, 4, null)).toBe(false);
    expect(hitsTrendSegment(Number.NaN, 0, 0, 0, 4, 0)).toBe(false);
    expect(hitsHorizontalLine(10, null)).toBe(false);
    expect(hitsHorizontalLine(Number.NaN, 10)).toBe(false);
    expect(hitsHorizontalLine(10, Number.POSITIVE_INFINITY)).toBe(false);
    expect(hitsTrendEndpoint(0, 0, null, 0)).toBe(false);
    expect(hitsTrendEndpoint(Number.NaN, 0, 0, 0)).toBe(false);
  });

  it("measures point distance and hits trend endpoints within CSS-pixel tolerance", () => {
    expect(pointDistance(0, 0, 3, 4)).toBe(5);
    expect(hitsTrendEndpoint(0, 0, 0, DRAWING_ENDPOINT_HIT_TOLERANCE_PX)).toBe(true);
    expect(hitsTrendEndpoint(0, 0, 0, DRAWING_ENDPOINT_HIT_TOLERANCE_PX + 0.5)).toBe(false);
  });

  it("prefers an endpoint hit over the segment when both would match", () => {
    expect(hitsTrendEndpoint(0, 0, 0, 0)).toBe(true);
    expect(hitsTrendSegment(0, 0, 0, 0, 20, 0)).toBe(true);
    expect(hitsTrendEndpoint(12, 0, 0, 0)).toBe(false);
    expect(hitsTrendSegment(12, 0, 0, 0, 20, 0)).toBe(true);
  });

  it("translates both trend endpoints from drag-start anchors and the current pointer", () => {
    const first = translateTrendBody(
      { x: 10, y: 40 },
      { x: 50, y: 80 },
      { x: 30, y: 60 },
      { x: 40, y: 70 },
    );
    expect(first).toEqual({ a: { x: 20, y: 50 }, b: { x: 60, y: 90 } });

    const second = translateTrendBody(
      { x: 10, y: 40 },
      { x: 50, y: 80 },
      { x: 30, y: 60 },
      { x: 50, y: 80 },
    );
    expect(second).toEqual({ a: { x: 30, y: 60 }, b: { x: 70, y: 100 } });
    expect(second.b.x - second.a.x).toBe(40);
    expect(second.b.y - second.a.y).toBe(40);
  });
});
