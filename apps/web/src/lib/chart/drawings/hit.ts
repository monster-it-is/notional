/**
 * Typed hit identity for the drawing primitive.
 *
 * Lightweight Charts only forwards `externalId` through hover/click events, so
 * region + drawing id are encoded here instead of string-splitting ad hoc in
 * the chart component.
 */

export const DRAWING_HIT_REGIONS = ["trend-a", "trend-b", "trend-body", "horizontal"] as const;

export type DrawingHitRegion = (typeof DRAWING_HIT_REGIONS)[number];

export type DrawingHit = {
  drawingId: string;
  region: DrawingHitRegion | null;
};

const HIT_SEPARATOR = "::";

export function isDrawingHitRegion(value: string): value is DrawingHitRegion {
  return (DRAWING_HIT_REGIONS as readonly string[]).includes(value);
}

export function drawingHitExternalId(drawingId: string, region: DrawingHitRegion): string {
  return `${region}${HIT_SEPARATOR}${drawingId}`;
}

export function parseDrawingHit(externalId: string | null | undefined): DrawingHit | null {
  if (typeof externalId !== "string" || externalId.length === 0) {
    return null;
  }

  const separatorIndex = externalId.indexOf(HIT_SEPARATOR);

  if (separatorIndex <= 0) {
    return { drawingId: externalId, region: null };
  }

  const region = externalId.slice(0, separatorIndex);
  const drawingId = externalId.slice(separatorIndex + HIT_SEPARATOR.length);

  if (!isDrawingHitRegion(region) || drawingId.length === 0) {
    return { drawingId: externalId, region: null };
  }

  return { drawingId, region };
}
