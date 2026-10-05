import { describe, expect, it } from "vitest";

import {
  DRAWING_HIT_TOLERANCE_PX,
  hitsHorizontalLine,
  hitsTrendSegment,
  pointToSegmentDistance,
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
  });
});
