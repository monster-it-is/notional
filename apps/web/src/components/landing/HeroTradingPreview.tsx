import { cn } from "../../lib/cn.ts";
import { FeedStatus, SampleTape, SessionClock } from "./DeskChrome.tsx";
import { formatTradingAmount } from "./format-decimal.ts";
import { isLandingFeedLive } from "./landing-feed-state.ts";
import { MarkTrace } from "./MarkTrace.tsx";
import { SymbolSwitch } from "./LiveMarketFigures.tsx";
import { TickValue } from "./TickValue.tsx";
import { useLandingMarket } from "./use-landing-market.ts";

const SAMPLE = [
  ["Side", "Long"],
  ["Leverage", "10×"],
  ["Margin mode", "Isolated"],
  ["Size", "0.100"],
  ["Entry", "60,000.00"],
  ["Sample mark", "60,420.00"],
  ["Virtual margin", "600.00"],
  ["Sample uPnL", "+42.00 gain"],
] as const;

export function HeroTradingPreview() {
  const { prints, symbol } = useLandingMarket();

  return (
    <div className="border border-border bg-surface shadow-[var(--shadow-raised)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-subtle px-2 sm:px-3">
        <SymbolSwitch />
        <span className="hidden font-numeric text-[10px] uppercase tracking-[0.16em] text-secondary sm:inline">
          Perp
        </span>
        <div className="ml-auto flex items-center gap-3 py-1">
          <FeedStatus />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 sm:px-4">
        <p className="text-[11px] uppercase tracking-[0.14em] text-secondary">
          Feed
          <span className="mx-2 text-border-strong">/</span>
          <span>Simulation</span>
          <span aria-hidden="true" className="feed-caret" />
        </p>
        <SessionClock className="hidden sm:inline" />
      </div>
      <HeroQuotes />
      <MarkTrace prints={prints} />
      <section
        aria-label="Sample position, not your account"
        className="border-t border-border"
      >
        <div className="flex items-baseline justify-between gap-3 px-3 py-2 sm:px-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-secondary">
            Sample position
          </p>
          <p className="text-[11px] text-secondary">
            Not your account · {symbol}
          </p>
        </div>
        <div className="grid sm:grid-cols-[minmax(0,1fr)_11.5rem]">
          <dl className="grid grid-cols-2 gap-px bg-border">
            {SAMPLE.map(([label, value]) => (
              <div key={label} className="bg-surface px-3 py-2.5 sm:px-4">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-secondary">
                  {label}
                </dt>
                <dd
                  className={
                    label === "Sample uPnL"
                      ? "mt-1 font-numeric text-sm text-positive"
                      : "mt-1 font-numeric text-sm text-foreground"
                  }
                >
                  {value}
                  {label === "Sample uPnL" ? (
                    <span className="sr-only"> illustrative</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
          <SampleTape className="hidden border-t border-border sm:block sm:border-t-0 sm:border-l" />
        </div>
        <p className="border-t border-border px-3 py-2 text-xs leading-relaxed text-secondary sm:px-4">
          Illustrative position. These figures are not a live order, a live
          position, or historical market data. The quote above is the only live
          market information in this panel.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 font-numeric text-[11px] text-secondary sm:px-4">
          <span>Paper</span>
          <span className="text-foreground">10×</span>
          <span>Isolated</span>
          <span>
            <span className="text-foreground">600.00</span> virtual margin
          </span>
          <span className="sm:ml-auto">Sample</span>
        </div>
        <div className="flex border-t border-border text-xs">
          <span className="bg-accent-soft px-3 py-2 text-foreground">
            Market
          </span>
          <span className="px-3 py-2 text-secondary">Limit</span>
          <span className="ml-auto px-3 py-2 text-secondary">Preview only</span>
        </div>
      </section>
    </div>
  );
}

function HeroQuotes() {
  const market = useLandingMarket();
  const live = isLandingFeedLive(market.feedState);
  const moveLabel = live
    ? market.markMove === "up"
      ? "Up"
      : market.markMove === "down"
        ? "Down"
        : market.markMove === "live"
          ? "Live"
          : null
    : null;
  const moveClass =
    market.markMove === "up"
      ? "text-positive"
      : market.markMove === "down"
        ? "text-negative"
        : "text-secondary";

  return (
    <div>
      <dl className="grid grid-cols-2 sm:grid-cols-[1fr_1.35fr_1fr]">
        <Quote
          className="order-2 border-r border-border sm:order-1 sm:border-r-0"
          label="Best bid"
          live={live}
          raw={market.bestBid}
        />
        <div className="order-1 col-span-2 border-b border-border bg-surface px-3 py-3 sm:order-2 sm:col-span-1 sm:border-x sm:border-b-0 sm:px-4">
          <dt className="text-[11px] uppercase tracking-[0.12em] text-secondary">
            Mark
          </dt>
          <dd className="mt-1 font-numeric text-2xl text-foreground">
            <TickValue
              display={quote(market.markPrice)}
              live={live}
              value={market.markPrice}
            />
            {moveLabel ? (
              <span className={`ml-2 text-xs ${moveClass}`}>{moveLabel}</span>
            ) : null}
          </dd>
        </div>
        <Quote
          className="order-3"
          label="Best ask"
          live={live}
          raw={market.bestAsk}
        />
      </dl>
      <dl className="grid grid-cols-2 border-t border-border">
        <Quote label="Index" live={live} raw={market.indexPrice} />
        <Quote label="Funding rate" live={live} raw={market.fundingRate} />
      </dl>
    </div>
  );
}

function Quote({
  label,
  raw,
  className,
  live = false,
}: {
  label: string;
  raw: string | undefined;
  className?: string;
  live?: boolean;
}) {
  return (
    <div className={cn("bg-surface px-3 py-3 sm:px-4", className)}>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-secondary">
        {label}
      </dt>
      <dd className="mt-1 font-numeric text-sm text-foreground">
        <TickValue display={quote(raw)} live={live} value={raw} />
      </dd>
    </div>
  );
}

function quote(value: string | undefined): string {
  return value ? formatTradingAmount(value) : "—";
}
