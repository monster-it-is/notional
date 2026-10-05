/**
 * Render-only hit geometry for chart drawings.
 *
 * Distances are CSS pixels. These calculations must never feed trading,
 * balances, canonical candles, or indicator math.
 */

export const DRAWING_HIT_TOLERANCE_PX = 6;
export const DRAWING_HANDLE_RADIUS_PX = 4;
export const DRAWING_SELECTED_HANDLE_RADIUS_PX = 5;
export const DRAWING_ENDPOINT_HIT_TOLERANCE_PX = 8;

export type ScreenPoint = {
  x: number;
  y: number;
};

export function pointDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

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

export function hitsTrendEndpoint(
  pointerX: number,
  pointerY: number,
  x: number | null,
  y: number | null,
  tolerancePx: number = DRAWING_ENDPOINT_HIT_TOLERANCE_PX,
): boolean {
  if (x === null || y === null) {
    return false;
  }

  if (![pointerX, pointerY, x, y, tolerancePx].every(Number.isFinite)) {
    return false;
  }

  return pointDistance(pointerX, pointerY, x, y) <= tolerancePx;
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

/**
 * Translate both trend endpoints by the pointer delta from drag start.
 * Always pass original screen anchors, never the previous preview.
 */
export function translateTrendBody(
  startA: ScreenPoint,
  startB: ScreenPoint,
  startPointer: ScreenPoint,
  pointer: ScreenPoint,
): { a: ScreenPoint; b: ScreenPoint } {
  const dx = pointer.x - startPointer.x;
  const dy = pointer.y - startPointer.y;

  return {
    a: { x: startA.x + dx, y: startA.y + dy },
    b: { x: startB.x + dx, y: startB.y + dy },
  };
}
