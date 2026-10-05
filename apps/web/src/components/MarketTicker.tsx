import type { InstrumentResponse } from "@notional/contracts";

import { formatAdaptiveMarketPriceDisplay } from "../lib/format-adaptive-market-price.ts";
import { formatCompactEpochMsUtc } from "../lib/format-timestamp.ts";
import { useTradeFeedState, tradeFeedStatusLabel } from "../lib/trade-feed-state.ts";
import { useMarketStore } from "../stores/market-store.ts";
import { useRealtimeStatusStore } from "../stores/realtime-status-store.ts";
import { NumericText } from "./ui/NumericText.tsx";
import { cn } from "../lib/cn.ts";

export function MarketTicker({
  symbol,
  instrument,
}: {
  symbol: string | null;
  instrument?: InstrumentResponse | null;
}) {
  const status = useRealtimeStatusStore((state) => state.market);
  const quote = useMarketStore((state) => (symbol ? state.quotes[symbol] : undefined));
  const feed = useTradeFeedState(status, quote?.mark?.markEventTime);
  const statusLabel = tradeFeedStatusLabel(feed);
  const live = feed === "live";
  const markPrice = quote?.mark?.markPrice;
  const indexPrice = quote?.mark?.indexPrice;

  if (!symbol) {
    return <p className="text-sm text-secondary">Select an instrument to see live market data.</p>;
  }

  const pair = instrument ? `${instrument.baseAsset}/${instrument.quoteAsset}` : symbol;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:gap-6">
        <div className="min-w-0 lg:max-w-xs lg:shrink-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-heading text-base text-foreground">{pair}</p>
            {instrument ? (
              <span className="inline-flex items-center rounded-sm border border-warning-border bg-warning-background px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-accent-ink">
                {instrument.contractType}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5 text-xs text-secondary">
              <span
                className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-accent" : "bg-muted")}
                aria-hidden="true"
              />
              {statusLabel}
            </span>
          </div>
          <NumericText className="mt-1.5 block min-w-0 max-w-full overflow-x-auto whitespace-nowrap text-2xl leading-none xl:text-[1.75rem]">
            {displayedMarketPrice(markPrice)}
          </NumericText>
          <p className="mt-1 text-xs text-secondary">Mark Price</p>
          {indexPrice ? (
            <p className="mt-0.5 min-w-0 text-xs text-muted">
              Index{" "}
              <NumericText className="text-xs text-muted">
                {formatAdaptiveMarketPriceDisplay(indexPrice)}
              </NumericText>
            </p>
          ) : null}
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:flex lg:min-w-0 lg:flex-1 lg:flex-wrap lg:items-end lg:gap-x-5 lg:gap-y-3">
          <TickerField label="Index" value={displayedMarketPrice(indexPrice)} />
          <TickerField
            label="Bid"
            value={displayedMarketPrice(quote?.bbo?.bestBidPrice)}
            quantity={quote?.bbo?.bestBidQty}
            tone="bid"
          />
          <TickerField
            label="Ask"
            value={displayedMarketPrice(quote?.bbo?.bestAskPrice)}
            quantity={quote?.bbo?.bestAskQty}
            tone="ask"
          />
          <TickerField label="Funding" value={quote?.mark?.fundingRate} />
          <TickerField
            label="Next Funding"
            value={
              quote?.mark?.nextFundingTime !== undefined
                ? formatCompactEpochMsUtc(quote.mark.nextFundingTime)
                : undefined
            }
            numeric={false}
          />
        </div>
      </div>
      {instrument ? <ContractConstraints instrument={instrument} /> : null}
    </div>
  );
}

function displayedMarketPrice(value: string | undefined): string {
  if (value === undefined) {
    return "—";
  }

  return formatAdaptiveMarketPriceDisplay(value);
}

function TickerField({
  label,
  value,
  quantity,
  numeric = true,
  tone,
}: {
  label: string;
  value: string | undefined;
  quantity?: string;
  numeric?: boolean;
  tone?: "bid" | "ask";
}) {
  const priceClass =
    tone === "bid" ? "text-positive" : tone === "ask" ? "text-negative" : undefined;

  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-secondary">{label}</p>
      {numeric ? (
        <NumericText
          className={cn(
            "block min-w-0 max-w-full overflow-x-auto whitespace-nowrap text-sm",
            priceClass,
          )}
        >
          {value ?? "—"}
        </NumericText>
      ) : (
        <p className="font-numeric text-sm text-foreground">{value ?? "—"}</p>
      )}
      {quantity !== undefined ? (
        <p className="min-w-0 max-w-full overflow-x-auto whitespace-nowrap text-xs text-secondary">
          <NumericText className="text-xs text-secondary">{quantity}</NumericText>
          <span className="text-muted"> qty</span>
        </p>
      ) : null}
    </div>
  );
}

function ContractConstraints({ instrument }: { instrument: InstrumentResponse }) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      <span className="whitespace-nowrap">
        Tick <NumericText className="text-xs text-muted">{instrument.tickSize}</NumericText>
      </span>
      <span className="whitespace-nowrap">
        Step <NumericText className="text-xs text-muted">{instrument.stepSize}</NumericText>
      </span>
      <span className="whitespace-nowrap">
        Min Qty <NumericText className="text-xs text-muted">{instrument.minQty}</NumericText>
      </span>
      <span className="whitespace-nowrap">
        Min Notional <NumericText className="text-xs text-muted">{instrument.minNotional}</NumericText>{" "}
        {instrument.quoteAsset}
      </span>
    </div>
  );
}
