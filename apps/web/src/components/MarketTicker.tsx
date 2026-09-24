import { NumericText } from "./ui/NumericText.tsx";
import { useMarketStore } from "../stores/market-store.ts";

export function MarketTicker({ symbol }: { symbol: string | null }) {
  const quote = useMarketStore((state) => (symbol ? state.quotes[symbol] : undefined));

  if (!symbol) {
    return <p className="text-sm text-secondary">Select an instrument to see live market data.</p>;
  }

  return (
    <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-6">
      <TickerField label="Mark" value={quote?.mark?.markPrice} />
      <TickerField label="Index" value={quote?.mark?.indexPrice} />
      <TickerField label="Best bid" value={quote?.bbo?.bestBidPrice} />
      <TickerField label="Best ask" value={quote?.bbo?.bestAskPrice} />
      <TickerField label="Funding rate" value={quote?.mark?.fundingRate} />
      <TickerField
        label="Next funding"
        value={
          quote?.mark?.nextFundingTime !== undefined
            ? formatNextFunding(quote.mark.nextFundingTime)
            : undefined
        }
        numeric={false}
      />
    </dl>
  );
}

function TickerField({
  label,
  value,
  numeric = true,
}: {
  label: string;
  value: string | undefined;
  numeric?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-secondary">{label}</dt>
      {numeric ? (
        <NumericText as="dd">{value ?? "—"}</NumericText>
      ) : (
        <dd className="text-foreground">{value ?? "—"}</dd>
      )}
    </div>
  );
}

function formatNextFunding(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
