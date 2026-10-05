import { describe, expect, it } from "vitest";

import { drawingHitExternalId, parseDrawingHit } from "./hit.ts";

describe("drawing hit identity", () => {
  it("encodes and parses a typed region without treating the drawing id as a string hack", () => {
    const encoded = drawingHitExternalId("abc-123", "trend-a");
    expect(parseDrawingHit(encoded)).toEqual({ drawingId: "abc-123", region: "trend-a" });
    expect(parseDrawingHit(drawingHitExternalId("abc-123", "trend-b"))).toEqual({
      drawingId: "abc-123",
      region: "trend-b",
    });
    expect(parseDrawingHit(drawingHitExternalId("abc-123", "trend-body"))).toEqual({
      drawingId: "abc-123",
      region: "trend-body",
    });
    expect(parseDrawingHit(drawingHitExternalId("h1", "horizontal"))).toEqual({
      drawingId: "h1",
      region: "horizontal",
    });
  });

  it("accepts a raw drawing id from click payloads that only carry the object id", () => {
    expect(parseDrawingHit("plain-id")).toEqual({ drawingId: "plain-id", region: null });
    expect(parseDrawingHit(null)).toBeNull();
    expect(parseDrawingHit("")).toBeNull();
  });
});
