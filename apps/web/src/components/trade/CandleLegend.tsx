import type { Candle, CandleInterval } from "@notional/contracts";

import { calculateCandleChange } from "../../lib/chart/candle-change.ts";
import { decimalVisualSign } from "../../lib/decimal-string.ts";
import { formatExactMoneyDisplay } from "../../lib/format-exact-money.ts";
import { formatEpochMsUtc } from "../../lib/format-timestamp.ts";
import { NumericText } from "../ui/NumericText.tsx";

export function CandleLegend({
  symbol,
  interval,
  candle,
}: {
  symbol: string;
  interval: CandleInterval;
  candle: Candle;
}) {
  const change = calculateCandleChange(candle.open, candle.close);
  const sign = change ? decimalVisualSign(change.change) : "zero";
  const signClass = directionClass(sign);
  const percentUnavailable = change?.changePercent == null;
  const changeText = formatSignedAmount(change?.change, sign);
  const percentText =
    change && change.changePercent !== null
      ? `${formatSignedAmount(change.changePercent, sign)}%`
      : "—";
  const percentClass = percentUnavailable ? "text-foreground" : signClass;

  return (
    <dl className="pointer-events-none absolute left-0 top-0 z-10 flex max-w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-surface/70 px-2 py-1 text-xs text-secondary">
      <div className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1">
        <dt className="sr-only">Instrument</dt>
        <dd className="min-w-0 text-secondary">
          {symbol} · {interval} · {formatEpochMsUtc(candle.openTime)}
        </dd>
      </div>
      <LegendField label="O" value={formatExactMoneyDisplay(candle.open)} />
      <LegendField label="H" value={formatExactMoneyDisplay(candle.high)} />
      <LegendField label="L" value={formatExactMoneyDisplay(candle.low)} />
      <LegendField label="C" value={formatExactMoneyDisplay(candle.close)} className={signClass} />
      <LegendField label="Change" value={changeText} className={signClass} />
      <LegendField label="Change %" value={percentText} className={percentClass} />
      <LegendField label="V" value={formatExactMoneyDisplay(candle.volume)} />
    </dl>
  );
}

function LegendField({
  label,
  value,
  className = "text-foreground",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1">
      <dt>{label}</dt>
      <NumericText as="dd" className={className}>
        {value}
      </NumericText>
    </div>
  );
}

function formatSignedAmount(
  value: string | undefined,
  sign: ReturnType<typeof decimalVisualSign>,
): string {
  if (value === undefined) {
    return "—";
  }

  const display = formatExactMoneyDisplay(value);
  return sign === "positive" ? `+${display}` : display;
}

function directionClass(sign: ReturnType<typeof decimalVisualSign>): string {
  if (sign === "positive") {
    return "text-positive";
  }

  if (sign === "negative") {
    return "text-negative";
  }

  return "text-foreground";
}
