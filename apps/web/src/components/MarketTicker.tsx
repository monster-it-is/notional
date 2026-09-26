import type { InstrumentResponse } from "@notional/contracts";

import { useTradeFeedState, tradeFeedStatusLabel } from "../lib/trade-feed-state.ts";
import { useMarketStore } from "../stores/market-store.ts";
import { useRealtimeStatusStore } from "../stores/realtime-status-store.ts";
import { NumericText } from "./ui/NumericText.tsx";

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

  if (!symbol) {
    return <p className="text-sm text-secondary">Select an instrument to see live market data.</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-secondary">Mark</p>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <NumericText className="text-2xl leading-none xl:text-[1.75rem]">
              {quote?.mark?.markPrice ?? "—"}
            </NumericText>
            <span className="text-xs text-secondary">{tradeFeedStatusLabel(feed)}</span>
          </div>
          {instrument ? (
            <p className="mt-1 text-xs text-secondary">
              {instrument.baseAsset}/{instrument.quoteAsset} · {instrument.contractType}
            </p>
          ) : null}
        </div>
        <TickerField label="Index" value={quote?.mark?.indexPrice} />
        <TickerField
          label="Bid"
          value={quote?.bbo?.bestBidPrice}
          quantity={quote?.bbo?.bestBidQty}
        />
        <TickerField
          label="Ask"
          value={quote?.bbo?.bestAskPrice}
          quantity={quote?.bbo?.bestAskQty}
        />
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
      </div>
      {instrument ? <ContractConstraints instrument={instrument} /> : null}
    </div>
  );
}

function TickerField({
  label,
  value,
  quantity,
  numeric = true,
}: {
  label: string;
  value: string | undefined;
  quantity?: string;
  numeric?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-secondary">{label}</p>
      {numeric ? (
        <NumericText className="text-sm">{value ?? "—"}</NumericText>
      ) : (
        <p className="font-numeric text-sm text-foreground">{value ?? "—"}</p>
      )}
      {quantity !== undefined ? (
        <NumericText className="block text-xs text-secondary">{quantity}</NumericText>
      ) : null}
    </div>
  );
}

function ContractConstraints({ instrument }: { instrument: InstrumentResponse }) {
  return (
    <p className="text-xs text-secondary">
      Tick <NumericText className="text-xs text-secondary">{instrument.tickSize}</NumericText>
      {" · "}
      Step <NumericText className="text-xs text-secondary">{instrument.stepSize}</NumericText>
      {" · "}
      Min qty <NumericText className="text-xs text-secondary">{instrument.minQty}</NumericText>
      {" · "}
      Min notional{" "}
      <NumericText className="text-xs text-secondary">{instrument.minNotional}</NumericText>{" "}
      {instrument.quoteAsset}
    </p>
  );
}

function formatNextFunding(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
