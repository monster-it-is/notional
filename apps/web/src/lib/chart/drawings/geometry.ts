/**
 * Render-only hit geometry for chart drawings.
 *
 * Distances are CSS pixels. These calculations must never feed trading,
 * balances, canonical candles, or indicator math.
 */

export const DRAWING_HIT_TOLERANCE_PX = 6;
export const DRAWING_HANDLE_RADIUS_PX = 4;

export function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function hitsTrendSegment(
  pointerX: number,
  pointerY: number,
  ax: number | null,
  ay: number | null,
  bx: number | null,
  by: number | null,
  tolerancePx: number = DRAWING_HIT_TOLERANCE_PX,
): boolean {
  if (ax === null || ay === null || bx === null || by === null) {
    return false;
  }

  if (![pointerX, pointerY, ax, ay, bx, by, tolerancePx].every(Number.isFinite)) {
    return false;
  }

  return pointToSegmentDistance(pointerX, pointerY, ax, ay, bx, by) <= tolerancePx;
}

export function hitsHorizontalLine(
  pointerY: number,
  lineY: number | null,
  tolerancePx: number = DRAWING_HIT_TOLERANCE_PX,
): boolean {
  if (lineY === null || !Number.isFinite(pointerY) || !Number.isFinite(lineY)) {
    return false;
  }

  return Math.abs(pointerY - lineY) <= tolerancePx;
}
