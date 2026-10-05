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
    <div className="flex min-w-0 max-w-full flex-col">
      <div
        className={cn(
          "grid min-w-0 max-w-full grid-cols-2 gap-x-4 gap-y-3",
          "sm:grid-cols-3",
          "lg:grid-cols-[minmax(190px,240px)_repeat(5,minmax(90px,1fr))] lg:items-start lg:gap-x-4 lg:gap-y-0",
        )}
      >
        <div className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-heading text-base font-medium tracking-tight text-foreground">{pair}</p>
            {instrument ? (
              <span className="inline-flex items-center rounded-sm border border-warning-border bg-warning-background px-1.5 py-px text-[0.65rem] font-medium uppercase leading-none tracking-wide text-accent-ink">
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
          <NumericText className="mt-1 block min-w-0 max-w-full overflow-x-auto overflow-y-hidden whitespace-nowrap text-2xl leading-none tracking-tight lg:text-[1.75rem]">
            {displayedMarketPrice(markPrice)}
          </NumericText>
          <p className="mt-1 text-xs uppercase tracking-wide text-secondary">Mark Price</p>
        </div>
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
            "mt-1 block min-w-0 max-w-full overflow-x-auto overflow-y-hidden whitespace-nowrap text-sm leading-none",
            priceClass,
          )}
        >
          {value ?? "—"}
        </NumericText>
      ) : (
        <p className="mt-1 font-numeric text-sm leading-none text-foreground">{value ?? "—"}</p>
      )}
      {quantity !== undefined ? (
        <p className="mt-1 min-w-0 max-w-full overflow-x-auto overflow-y-hidden whitespace-nowrap text-xs text-secondary">
          <NumericText className="text-xs text-secondary">{quantity}</NumericText>
          <span className="text-muted"> qty</span>
        </p>
      ) : null}
    </div>
  );
}

function ContractConstraints({ instrument }: { instrument: InstrumentResponse }) {
  return (
    <div className="mt-2 flex min-w-0 max-w-full flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border pt-1.5 text-xs text-muted lg:flex-nowrap lg:justify-between">
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
