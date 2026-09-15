import { useQuery } from "@tanstack/react-query";

import { listLiquidations } from "../lib/api/liquidations.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";

export function LiquidationsTable({ limit, offset }: { limit: number; offset: number }) {
  const query = useQuery({
    queryKey: queryKeys.liquidations.list({ limit, offset }),
    queryFn: () => listLiquidations({ limit, offset }),
  });

  if (query.isLoading) {
    return <p className="text-sm text-app-text">Loading liquidations…</p>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const rows = query.data?.liquidations ?? [];

  if (rows.length === 0) {
    return <EmptyState>No liquidations.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-app-text">
            <th className="py-2 pr-3">Time</th>
            <th className="py-2 pr-3">Mode</th>
            <th className="py-2 pr-3">Symbol</th>
            <th className="py-2 pr-3">Equity snapshot</th>
            <th className="py-2 pr-3">Maintenance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-app-border text-app-heading">
              <td className="py-2 pr-3">{row.createdAt}</td>
              <td className="py-2 pr-3">{row.marginMode}</td>
              <td className="py-2 pr-3">{row.symbol ?? "CROSS"}</td>
              <td className="py-2 pr-3 tabular-nums">{row.equity}</td>
              <td className="py-2 pr-3 tabular-nums">{row.maintenanceMargin}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
