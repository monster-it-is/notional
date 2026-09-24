import { cn } from "../../lib/cn.ts";
import { isLandingFeedLive } from "./landing-feed-state.ts";
import { formatTradingAmount } from "./format-decimal.ts";
import { TickValue } from "./TickValue.tsx";
import { LANDING_SYMBOLS, useLandingMarket, type MarkMove } from "./use-landing-market.ts";

function formatQuote(value: string | undefined): string {
  if (!value) {
    return "—";
  }

  return formatTradingAmount(value);
}

export function LiveMarketFigures({ featured = false }: { featured?: boolean }) {
  const market = useLandingMarket();

  return (
    <div>
      <dl className={cn("grid grid-cols-2 gap-px bg-border", featured ? "sm:grid-cols-3" : "sm:grid-cols-5")}>
        <QuoteCell
          direction={isLandingFeedLive(market.feedState) ? market.markMove : undefined}
          emphasize={featured}
          label="Mark"
          live={isLandingFeedLive(market.feedState)}
          raw={market.markPrice}
          value={formatQuote(market.markPrice)}
        />
        <QuoteCell
          label="Index"
          live={isLandingFeedLive(market.feedState)}
          raw={market.indexPrice}
          value={formatQuote(market.indexPrice)}
        />
        <QuoteCell
          label="Best bid"
          live={isLandingFeedLive(market.feedState)}
          raw={market.bestBid}
          value={formatQuote(market.bestBid)}
        />
        <QuoteCell
          label="Best ask"
          live={isLandingFeedLive(market.feedState)}
          raw={market.bestAsk}
          value={formatQuote(market.bestAsk)}
        />
        <QuoteCell
          className={featured ? undefined : "col-span-2 sm:col-span-1"}
          label="Funding rate"
          live={isLandingFeedLive(market.feedState)}
          raw={market.fundingRate}
          value={formatQuote(market.fundingRate)}
        />
        {featured ? <QuoteCell label="Symbol" value={market.symbol} /> : null}
      </dl>
    </div>
  );
}

function QuoteCell({
  label,
  value,
  raw,
  direction,
  live = false,
  emphasize = false,
  className,
}: {
  label: string;
  value: string;
  raw?: string;
  direction?: MarkMove;
  live?: boolean;
  emphasize?: boolean;
  className?: string;
}) {
  const moveLabel =
    direction === "up" ? "Up" : direction === "down" ? "Down" : direction === "live" ? "Live" : null;
  const moveClass =
    direction === "up" ? "text-positive" : direction === "down" ? "text-negative" : "text-secondary";

  return (
    <div className={cn("bg-surface px-3 py-3 sm:px-4", className)}>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-secondary">{label}</dt>
      <dd
        className={cn(
          "mt-1 break-all font-numeric text-foreground",
          emphasize ? "text-2xl" : "text-sm",
        )}
      >
        <TickValue display={value} live={live} value={raw} />
        {moveLabel ? <span className={cn("ml-2 text-xs", moveClass)}>{moveLabel}</span> : null}
      </dd>
    </div>
  );
}

export function SymbolSwitch() {
  const { symbol, setSymbol } = useLandingMarket();

  return (
    <div aria-label="Market" className="flex" role="group">
      {LANDING_SYMBOLS.map((item) => {
        const selected = item === symbol;

        return (
          <button
            key={item}
            aria-pressed={selected}
            className={cn(
              "min-h-11 px-3 font-numeric text-xs sm:text-sm",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selected
                ? "text-foreground shadow-[inset_0_-2px_0_0_var(--accent)]"
                : "text-secondary hover:text-foreground",
            )}
            onClick={() => setSymbol(item)}
            type="button"
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}
