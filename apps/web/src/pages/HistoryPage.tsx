import type { OrderStatus } from "@notional/contracts";
import { useState } from "react";

import { ExecutionsTable } from "../components/ExecutionsTable.tsx";
import { LiquidationsTable } from "../components/LiquidationsTable.tsx";
import { OrdersHistoryTable } from "../components/OrdersHistoryTable.tsx";
import { PerpFundingTable } from "../components/PerpFundingTable.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { Select } from "../components/ui/Select.tsx";
import { Tabs } from "../components/ui/Tabs.tsx";
import { Button } from "../components/ui/Button.tsx";

type HistoryTab = "orders" | "executions" | "funding" | "liquidations";

const PAGE_SIZE = 50;

export function HistoryPage() {
  const [tab, setTab] = useState<HistoryTab>("orders");
  const [symbol, setSymbol] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [offset, setOffset] = useState(0);

  function changeTab(next: HistoryTab): void {
    setTab(next);
    setOffset(0);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl">History</h1>
      <Panel>
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block">Symbol filter</span>
            <Input
              value={symbol}
              onChange={(event) => {
                setSymbol(event.target.value.toUpperCase());
                setOffset(0);
              }}
              aria-label="Symbol filter"
              placeholder="BTCUSDT"
            />
          </label>
          {tab === "orders" ? (
            <label className="text-sm">
              <span className="mb-1 block">Status</span>
              <Select
                aria-label="Order status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as OrderStatus | "");
                  setOffset(0);
                }}
              >
                <option value="">All</option>
                <option value="OPEN">OPEN</option>
                <option value="FILLED">FILLED</option>
                <option value="CANCELLED">CANCELLED</option>
              </Select>
            </label>
          ) : null}
        </div>
        <Tabs
          tabs={[
            { id: "orders", label: "Orders" },
            { id: "executions", label: "Executions" },
            { id: "funding", label: "Perpetual funding" },
            { id: "liquidations", label: "Liquidations" },
          ]}
          value={tab}
          onChange={changeTab}
        />
        <div className="mt-4">
          {tab === "orders" ? (
            <OrdersHistoryTable
              status={status || undefined}
              symbol={symbol || undefined}
              limit={PAGE_SIZE}
              offset={offset}
            />
          ) : null}
          {tab === "executions" ? (
            <ExecutionsTable symbol={symbol || undefined} limit={PAGE_SIZE} offset={offset} />
          ) : null}
          {tab === "funding" ? <PerpFundingTable limit={PAGE_SIZE} offset={offset} /> : null}
          {tab === "liquidations" ? <LiquidationsTable limit={PAGE_SIZE} offset={offset} /> : null}
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
          <Button type="button" onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </Button>
        </div>
      </Panel>
    </div>
  );
}
