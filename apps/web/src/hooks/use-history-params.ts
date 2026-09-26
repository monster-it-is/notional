import type { OrderStatus } from "@notional/contracts";
import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";

import { normalizeSymbolInput } from "../lib/canonical-symbol.ts";

export const HISTORY_TABS = ["orders", "executions", "funding", "liquidations"] as const;

export type HistoryTab = (typeof HISTORY_TABS)[number];

export type HistoryOrderStatus = OrderStatus | "";

export type HistorySearchState = {
  tab: HistoryTab;
  symbol: string;
  status: HistoryOrderStatus;
  offset: number;
};

const ORDER_STATUSES: readonly OrderStatus[] = ["OPEN", "FILLED", "CANCELLED"];

function isHistoryTab(value: string): value is HistoryTab {
  return (HISTORY_TABS as readonly string[]).includes(value);
}

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

function symbolApplies(tab: HistoryTab): boolean {
  return tab === "orders" || tab === "executions";
}

function statusApplies(tab: HistoryTab): boolean {
  return tab === "orders";
}

export function parseHistoryOffset(raw: string | null): number {
  if (raw === null || raw === "" || raw === "0") {
    return 0;
  }

  if (raw.length > 9 || !/^[0-9]+$/.test(raw)) {
    return 0;
  }

  let value = 0;
  for (const ch of raw) {
    value = value * 10 + (ch.charCodeAt(0) - 48);
  }

  return value;
}

export function parseHistorySearch(params: URLSearchParams): HistorySearchState {
  const rawTab = params.get("tab");
  const tab = rawTab !== null && isHistoryTab(rawTab) ? rawTab : "orders";

  const rawSymbol = params.get("symbol") ?? "";
  const symbol = symbolApplies(tab) ? normalizeSymbolInput(rawSymbol) : "";

  const rawStatus = params.get("status");
  const status =
    statusApplies(tab) && rawStatus !== null && isOrderStatus(rawStatus) ? rawStatus : "";

  const offset = parseHistoryOffset(params.get("offset"));

  return { tab, symbol, status, offset };
}

export function serializeHistorySearch(state: HistorySearchState): URLSearchParams {
  const next = new URLSearchParams();

  if (state.tab !== "orders") {
    next.set("tab", state.tab);
  }

  if (symbolApplies(state.tab) && state.symbol.length > 0) {
    next.set("symbol", state.symbol);
  }

  if (statusApplies(state.tab) && state.status !== "") {
    next.set("status", state.status);
  }

  if (state.offset > 0) {
    next.set("offset", String(state.offset));
  }

  return next;
}

export function useHistoryParams(): HistorySearchState & {
  setTab: (tab: HistoryTab) => void;
  setSymbol: (symbol: string) => void;
  setStatus: (status: HistoryOrderStatus) => void;
  setOffset: (offset: number) => void;
} {
  const [params, setParams] = useSearchParams();
  const parsed = parseHistorySearch(params);
  const canonicalQuery = serializeHistorySearch(parsed).toString();
  const currentQuery = params.toString();

  useEffect(() => {
    if (currentQuery !== canonicalQuery) {
      setParams(new URLSearchParams(canonicalQuery), { replace: true });
    }
  }, [canonicalQuery, currentQuery, setParams]);

  const commit = useCallback(
    (next: HistorySearchState, replace: boolean) => {
      setParams(serializeHistorySearch(next), { replace });
    },
    [setParams],
  );

  const setTab = useCallback(
    (tab: HistoryTab) => {
      commit(
        {
          tab,
          symbol: symbolApplies(tab) ? parsed.symbol : "",
          status: statusApplies(tab) ? parsed.status : "",
          offset: 0,
        },
        false,
      );
    },
    [commit, parsed.symbol, parsed.status],
  );

  const setSymbol = useCallback(
    (symbol: string) => {
      commit(
        {
          tab: parsed.tab,
          symbol: normalizeSymbolInput(symbol),
          status: parsed.status,
          offset: 0,
        },
        true,
      );
    },
    [commit, parsed.tab, parsed.status],
  );

  const setStatus = useCallback(
    (status: HistoryOrderStatus) => {
      commit(
        {
          tab: parsed.tab,
          symbol: parsed.symbol,
          status,
          offset: 0,
        },
        false,
      );
    },
    [commit, parsed.tab, parsed.symbol],
  );

  const setOffset = useCallback(
    (offset: number) => {
      commit(
        {
          tab: parsed.tab,
          symbol: parsed.symbol,
          status: parsed.status,
          offset,
        },
        false,
      );
    },
    [commit, parsed.tab, parsed.symbol, parsed.status],
  );

  return {
    ...parsed,
    setTab,
    setSymbol,
    setStatus,
    setOffset,
  };
}
