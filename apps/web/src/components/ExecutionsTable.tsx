import { useQuery } from "@tanstack/react-query";

import { listExecutions } from "../lib/api/executions.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";

export function ExecutionsTable({
  symbol,
  limit = 20,
  offset = 0,
}: {
  symbol?: string;
  limit?: number;
  offset?: number;
}) {
  const query = useQuery({
    queryKey: queryKeys.executions.list({ symbol, limit, offset }),
    queryFn: () => listExecutions({ symbol, limit, offset }),
  });

  if (query.isLoading) {
    return <p className="text-sm text-app-text">Loading executions…</p>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const executions = query.data?.executions ?? [];

  if (executions.length === 0) {
    return <EmptyState>No executions.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-app-text">
            <th className="py-2 pr-3">Time</th>
            <th className="py-2 pr-3">Symbol</th>
            <th className="py-2 pr-3">Side</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Quantity</th>
            <th className="py-2 pr-3">Price</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((execution) => (
            <tr key={execution.id} className="border-t border-app-border text-app-heading">
              <td className="py-2 pr-3">{execution.executedAt}</td>
              <td className="py-2 pr-3">{execution.symbol}</td>
              <td className="py-2 pr-3">{execution.side}</td>
              <td className="py-2 pr-3">{execution.orderType}</td>
              <td className="py-2 pr-3 tabular-nums">{execution.quantity}</td>
              <td className="py-2 pr-3 tabular-nums">{execution.price}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
