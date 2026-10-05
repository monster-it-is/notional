import type { CandlestickData } from "lightweight-charts";

export type ChartSeriesMutation = "update" | "setData";

export function classifyChartSeriesMutation(
  previous: readonly CandlestickData[],
  next: readonly CandlestickData[],
): ChartSeriesMutation {
  if (previous.length === 0 || next.length === 0) {
    return "setData";
  }

  const previousLast = previous[previous.length - 1];
  const nextLast = next[next.length - 1];

  if (!previousLast || !nextLast) {
    return "setData";
  }

  if (previous.length === next.length) {
    if (previousLast.time !== nextLast.time) {
      return "setData";
    }

    for (let index = 0; index < previous.length - 1; index += 1) {
      const left = previous[index];
      const right = next[index];

      if (!left || !right || !samePoint(left, right)) {
        return "setData";
      }
    }

    return "update";
  }

  if (next.length === previous.length + 1) {
    for (let index = 0; index < previous.length; index += 1) {
      const left = previous[index];
      const right = next[index];

      if (!left || !right || !samePoint(left, right)) {
        return "setData";
      }
    }

    if (nextLast.time > previousLast.time) {
      return "update";
    }
  }

  return "setData";
}

export function countLeftPrependedBars(
  previous: readonly CandlestickData[],
  next: readonly CandlestickData[],
): number {
  const previousFirst = previous[0]?.time;

  if (typeof previousFirst !== "number" || previous.length === 0 || next.length === 0) {
    return 0;
  }

  let count = 0;

  for (const point of next) {
    if (typeof point.time === "number" && point.time < previousFirst) {
      count += 1;
      continue;
    }

    break;
  }

  return count;
}

function samePoint(left: CandlestickData, right: CandlestickData): boolean {
  return (
    left.time === right.time &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close
  );
}
