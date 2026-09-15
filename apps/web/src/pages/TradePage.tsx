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
import { Panel } from "../components/ui/Panel.tsx";
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
  const [tab, setTab] = useState<"positions" | "orders" | "executions">("positions");

  useEffect(() => {
    const socket = getMarketSocket();
    socket.setDesiredSymbol(symbol);
    return () => {
      socket.setDesiredSymbol(null);
    };
  }, [symbol]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <Panel title="Market" className="lg:w-2/3">
          <div className="mb-4 max-w-xs">
            <SymbolSelector instruments={instruments} value={symbol} onChange={setSymbol} />
          </div>
          <MarketTicker symbol={symbol} />
        </Panel>
        <Panel title="Order ticket" className="lg:w-1/3">
          <div className="space-y-4">
            <MarginControls symbol={symbol} disabled={suspended} />
            <OrderForm symbol={symbol} disabled={suspended} />
          </div>
        </Panel>
      </div>

      <Panel>
        <Tabs
          tabs={[
            { id: "positions", label: "Positions" },
            { id: "orders", label: "Open orders" },
            { id: "executions", label: "Recent executions" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="mt-4">
          {tab === "positions" ? <PositionsTable /> : null}
          {tab === "orders" ? <OpenOrdersTable /> : null}
          {tab === "executions" ? <ExecutionsTable limit={20} offset={0} /> : null}
        </div>
      </Panel>
    </div>
  );
}
