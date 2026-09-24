import type { MarginMode } from "@notional/contracts";
import { MAX_LEVERAGE, MIN_LEVERAGE } from "@notional/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getMarginSettings, putMarginSettings } from "../lib/api/margin.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { invalidateAfterMargin } from "../realtime/invalidate.ts";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { Select } from "./ui/Select.tsx";

const LEVERAGE_VALUES = leverageValues();

export function MarginControls({
  symbol,
  disabled,
}: {
  symbol: string | null;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: symbol ? queryKeys.marginSettings.symbol(symbol) : ["marginSettings", "none"],
    queryFn: () => getMarginSettings(symbol as string),
    enabled: Boolean(symbol),
  });

  const mutation = useMutation({
    retry: false,
    mutationFn: (input: { marginMode: MarginMode; leverage: number }) =>
      putMarginSettings(symbol as string, input),
    onSuccess: () => {
      invalidateAfterMargin(queryClient);
    },
  });

  if (!symbol) {
    return null;
  }

  const settings = query.data;

  return (
    <div className="space-y-3">
      {query.error ? <ErrorBanner error={query.error} /> : null}
      {mutation.error ? <ErrorBanner error={mutation.error} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-secondary">Margin mode</span>
          <Select
            aria-label="Margin mode"
            value={settings?.marginMode ?? "CROSS"}
            disabled={disabled || mutation.isPending || !settings}
            onChange={(event) => {
              if (!settings) {
                return;
              }

              mutation.mutate({
                marginMode: event.target.value as MarginMode,
                leverage: settings.leverage,
              });
            }}
          >
            <option value="CROSS">CROSS</option>
            <option value="ISOLATED">ISOLATED</option>
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-secondary">Leverage</span>
          <Select
            aria-label="Leverage"
            value={settings ? String(settings.leverage) : "1"}
            disabled={disabled || mutation.isPending || !settings}
            onChange={(event) => {
              if (!settings) {
                return;
              }

              mutation.mutate({
                marginMode: settings.marginMode,
                leverage: toLeverage(event.target.value),
              });
            }}
          >
            {LEVERAGE_VALUES.map((value) => (
              <option key={value} value={String(value)}>
                {value}x
              </option>
            ))}
          </Select>
        </label>
      </div>
      {mutation.isPending ? <p className="text-xs text-secondary">Saving margin settings…</p> : null}
      <p className="text-xs text-secondary">
        Margin mode and leverage can change only while the position is flat and there are no open
        orders.
      </p>
    </div>
  );
}

function leverageValues(): number[] {
  const values: number[] = [];
  let value = MIN_LEVERAGE;

  while (value <= MAX_LEVERAGE) {
    values.push(value);
    value += 1;
  }

  return values;
}

function toLeverage(raw: string): number {
  for (const value of LEVERAGE_VALUES) {
    if (String(value) === raw) {
      return value;
    }
  }

  return MIN_LEVERAGE;
}
