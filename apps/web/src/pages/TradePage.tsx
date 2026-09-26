import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";

import { ExecutionsTable } from "../components/ExecutionsTable.tsx";
import { MarginControls } from "../components/MarginControls.tsx";
import { MarketTicker } from "../components/MarketTicker.tsx";
import { OpenOrdersTable } from "../components/OpenOrdersTable.tsx";
import { OrderForm } from "../components/OrderForm.tsx";
import { PositionsTable } from "../components/PositionsTable.tsx";
import { SymbolSelector } from "../components/SymbolSelector.tsx";
import { ErrorBanner } from "../components/ui/ErrorBanner.tsx";
import { Surface } from "../components/ui/Surface.tsx";
import { Tabs } from "../components/ui/Tabs.tsx";
import { useSelectedSymbol } from "../hooks/use-selected-symbol.ts";
import { listInstruments } from "../lib/api/instruments.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { getMarketSocket } from "../realtime/runtime.ts";

type OutletContext = { suspended: boolean };

export function TradePage() {
  const { suspended } = useOutletContext<OutletContext>();
  const instrumentsQuery = useQuery({
    queryKey: queryKeys.instruments,
    queryFn: listInstruments,
    staleTime: 5 * 60_000,
  });
  const instruments = instrumentsQuery.data?.instruments ?? [];
  const fallback = instruments[0]?.symbol ?? null;
  const { symbol, setSymbol } = useSelectedSymbol(fallback);
  const instrument = instruments.find((row) => row.symbol === symbol) ?? null;
  const [tab, setTab] = useState<"positions" | "orders" | "executions">("positions");

  useEffect(() => {
    const socket = getMarketSocket();
    socket.setDesiredSymbol(symbol);
    return () => {
      socket.setDesiredSymbol(null);
    };
  }, [symbol]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h1 className="sr-only">Trade</h1>

      <Surface as="section" className="min-w-0">
        <h2 className="sr-only">Instrument</h2>
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:gap-6">
          <div className="w-full min-w-0 xl:max-w-xs">
            {instrumentsQuery.isLoading ? (
              <p className="text-sm text-secondary">Loading instruments…</p>
            ) : null}
            {instrumentsQuery.error ? <ErrorBanner error={instrumentsQuery.error} /> : null}
            {instrumentsQuery.isLoading ? null : (
              <SymbolSelector
                instruments={instruments}
                value={symbol}
                onChange={setSymbol}
                disabled={instruments.length === 0}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <MarketTicker symbol={symbol} instrument={instrument} />
          </div>
        </div>
      </Surface>

      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
        <Surface as="section" className="order-2 min-w-0 flex-1 lg:order-1">
          <h2 className="sr-only">Positions and orders</h2>
          <Tabs
            tabs={[
              { id: "positions", label: "Positions" },
              { id: "orders", label: "Open orders" },
              { id: "executions", label: "Recent executions" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="mt-3 min-w-0">
            {tab === "positions" ? <PositionsTable /> : null}
            {tab === "orders" ? <OpenOrdersTable /> : null}
            {tab === "executions" ? <ExecutionsTable limit={20} offset={0} /> : null}
          </div>
        </Surface>

        <Surface
          as="section"
          className="order-1 w-full min-w-0 lg:order-2 lg:w-[22rem] lg:shrink-0 xl:w-[24rem]"
        >
          <h2 className="mb-2 font-heading text-base text-foreground">Order ticket</h2>
          {suspended ? (
            <p className="mb-2 text-xs text-secondary">Trading is disabled for this paper account.</p>
          ) : null}
          <div className="space-y-3">
            <MarginControls symbol={symbol} disabled={suspended} />
            <OrderForm
              symbol={symbol}
              disabled={suspended}
              baseAsset={instrument?.baseAsset}
              quoteAsset={instrument?.quoteAsset}
            />
          </div>
        </Surface>
      </div>
    </div>
  );
}
