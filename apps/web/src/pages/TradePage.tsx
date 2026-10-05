import type { OrderSide } from "@notional/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";

import { ExecutionsTable } from "../components/ExecutionsTable.tsx";
import { MarginControls } from "../components/MarginControls.tsx";
import { MarketTicker } from "../components/MarketTicker.tsx";
import { OpenOrdersTable } from "../components/OpenOrdersTable.tsx";
import { OrderForm, type ReducePrefillCommand } from "../components/OrderForm.tsx";
import { PositionsTable } from "../components/PositionsTable.tsx";
import { SymbolSelector } from "../components/SymbolSelector.tsx";
import { MarketChart } from "../components/trade/MarketChart.tsx";
import { ErrorBanner } from "../components/ui/ErrorBanner.tsx";
import { Surface } from "../components/ui/Surface.tsx";
import { Tabs } from "../components/ui/Tabs.tsx";
import { useSelectedSymbol } from "../hooks/use-selected-symbol.ts";
import { useTradeChartInterval } from "../hooks/use-trade-chart-interval.ts";
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
  const { interval, setChartInterval } = useTradeChartInterval();
  const instrument = instruments.find((row) => row.symbol === symbol) ?? null;
  const [tab, setTab] = useState<"positions" | "orders" | "executions">("positions");
  const [closePending, setClosePending] = useState(false);
  const [ticketPending, setTicketPending] = useState(false);
  const [reducePrefill, setReducePrefill] = useState<ReducePrefillCommand | null>(null);
  const nextReduceId = useRef(0);

  function requestReduce(command: { symbol: string; side: OrderSide }): void {
    if (suspended || closePending || ticketPending) {
      return;
    }

    nextReduceId.current += 1;
    if (symbol !== command.symbol) {
      setSymbol(command.symbol);
    }
    setReducePrefill({
      id: nextReduceId.current,
      symbol: command.symbol,
      side: command.side,
    });
  }

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
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(180px,220px)_minmax(0,1fr)] md:items-start md:gap-4">
          <div className="min-w-0">
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
          <div className="min-w-0">
            <MarketTicker symbol={symbol} instrument={instrument} />
          </div>
        </div>
      </Surface>

      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-stretch">
        <Surface as="section" className="min-w-0 flex-1">
          <MarketChart symbol={symbol} interval={interval} onIntervalChange={setChartInterval} />
        </Surface>

        <Surface
          as="section"
          className="w-full min-w-0 lg:w-[22rem] lg:shrink-0 xl:w-[24rem]"
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
              reducePrefill={reducePrefill}
              onPendingChange={setTicketPending}
            />
          </div>
        </Surface>
      </div>

      <Surface as="section" className="min-w-0">
        <h2 className="sr-only">Positions and orders</h2>
        <Tabs
          tabs={[
            { id: "positions", label: "Positions" },
            { id: "orders", label: "Open orders", disabled: closePending },
            { id: "executions", label: "Recent executions", disabled: closePending },
          ]}
          value={tab}
          onChange={(id) => {
            if (closePending && id !== "positions") {
              return;
            }

            setTab(id);
          }}
        />
        <div className="mt-3 min-w-0">
          {tab === "positions" ? (
            <PositionsTable
              disabled={suspended}
              reduceDisabled={ticketPending}
              onClosePendingChange={setClosePending}
              onReduce={requestReduce}
            />
          ) : null}
          {tab === "orders" ? <OpenOrdersTable /> : null}
          {tab === "executions" ? <ExecutionsTable limit={20} offset={0} /> : null}
        </div>
      </Surface>
    </div>
  );
}
