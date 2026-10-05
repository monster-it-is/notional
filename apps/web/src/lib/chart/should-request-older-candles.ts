export const BACKFILL_LOGICAL_THRESHOLD = 50;

export type BarsInLogicalRangeInfo = {
  barsBefore: number;
  barsAfter: number;
} | null;

export function shouldRequestOlderCandles(info: BarsInLogicalRangeInfo): boolean {
  if (info === null) {
    return false;
  }

  return (
    info.barsBefore < BACKFILL_LOGICAL_THRESHOLD && info.barsAfter > BACKFILL_LOGICAL_THRESHOLD
  );
}
