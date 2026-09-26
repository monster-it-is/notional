import { useCallback, useState } from "react";

import { ExecutionsTable } from "../components/ExecutionsTable.tsx";
import { LiquidationsTable } from "../components/LiquidationsTable.tsx";
import { OffsetPagination } from "../components/OffsetPagination.tsx";
import { OrdersHistoryTable } from "../components/OrdersHistoryTable.tsx";
import { PerpFundingTable } from "../components/PerpFundingTable.tsx";
import { FormField } from "../components/ui/FormField.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { Select } from "../components/ui/Select.tsx";
import { Tabs } from "../components/ui/Tabs.tsx";
import { EmptyState } from "../components/ui/EmptyState.tsx";
import { type HistoryTab, useHistoryParams } from "../hooks/use-history-params.ts";
import { isBlockedHistorySymbol, isCanonicalSymbol } from "../lib/canonical-symbol.ts";

const PAGE_SIZE = 50;

const HISTORY_TABS: { id: HistoryTab; label: string }[] = [
  { id: "orders", label: "Orders" },
  { id: "executions", label: "Executions" },
  { id: "funding", label: "Perpetual funding" },
  { id: "liquidations", label: "Liquidations" },
];

export function HistoryPage() {
  const { tab, symbol, status, offset, setTab, setSymbol, setStatus, setOffset } =
    useHistoryParams();
  const symbolBlocked = isBlockedHistorySymbol(symbol);
  const symbolFilter = isCanonicalSymbol(symbol) ? symbol : undefined;
  const queryEpoch = `${tab}|${symbol}|${status}|${offset}`;
  const [rowCountByEpoch, setRowCountByEpoch] = useState<Record<string, number | null>>({});
  const rowCount = rowCountByEpoch[queryEpoch] ?? null;

  const onRowCountChange = useCallback(
    (next: number | null) => {
      setRowCountByEpoch((prev) => {
        if (prev[queryEpoch] === next) {
          return prev;
        }

        return { [queryEpoch]: next };
      });
    },
    [queryEpoch],
  );

  const showSymbolFilter = tab === "orders" || tab === "executions";
  const queryBlocked = showSymbolFilter && symbolBlocked;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">History</h1>
        <p className="text-sm text-secondary">
          Orders, fills, funding, and liquidations for this paper account.
        </p>
      </div>
      <Panel>
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {showSymbolFilter ? (
            <FormField label="Symbol filter">
              <Input
                value={symbol}
                invalid={symbolBlocked}
                onChange={(event) => setSymbol(event.target.value)}
                aria-label="Symbol filter"
                placeholder="BTCUSDT"
                aria-describedby={symbolBlocked ? "history-symbol-hint" : undefined}
              />
              {symbolBlocked ? (
                <p id="history-symbol-hint" className="mt-1 text-sm text-warning">
                  Use a symbol like BTCUSDT
                </p>
              ) : null}
            </FormField>
          ) : null}
          {tab === "orders" ? (
            <FormField label="Status">
              <Select
                aria-label="Order status"
                value={status}
                onChange={(event) => {
                  const next = event.target.value;
                  setStatus(next === "OPEN" || next === "FILLED" || next === "CANCELLED" ? next : "");
                }}
              >
                <option value="">All</option>
                <option value="OPEN">OPEN</option>
                <option value="FILLED">FILLED</option>
                <option value="CANCELLED">CANCELLED</option>
              </Select>
            </FormField>
          ) : null}
        </div>
        <Tabs tabs={HISTORY_TABS} value={tab} onChange={setTab} />
        <div className="mt-4 min-w-0">
          {queryBlocked ? <EmptyState>Use a symbol like BTCUSDT</EmptyState> : null}
          {queryBlocked ? null : tab === "orders" ? (
            <OrdersHistoryTable
              key={queryEpoch}
              status={status || undefined}
              symbol={symbolFilter}
              limit={PAGE_SIZE}
              offset={offset}
              onRowCountChange={onRowCountChange}
            />
          ) : null}
          {queryBlocked ? null : tab === "executions" ? (
            <ExecutionsTable
              key={queryEpoch}
              symbol={symbolFilter}
              limit={PAGE_SIZE}
              offset={offset}
              showOrderId
              onRowCountChange={onRowCountChange}
            />
          ) : null}
          {tab === "funding" ? (
            <PerpFundingTable
              key={queryEpoch}
              limit={PAGE_SIZE}
              offset={offset}
              onRowCountChange={onRowCountChange}
            />
          ) : null}
          {tab === "liquidations" ? (
            <LiquidationsTable
              key={queryEpoch}
              limit={PAGE_SIZE}
              offset={offset}
              onRowCountChange={onRowCountChange}
            />
          ) : null}
        </div>
        <OffsetPagination
          offset={offset}
          pageSize={PAGE_SIZE}
          rowCount={rowCount}
          onPrevious={() => setOffset(offset > PAGE_SIZE ? offset - PAGE_SIZE : 0)}
          onNext={() => setOffset(offset + PAGE_SIZE)}
        />
      </Panel>
    </div>
  );
}
