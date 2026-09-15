import type { PrivateResource } from "@notional/contracts";
import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../lib/query-keys.ts";

export const PRIVATE_RESOURCES: PrivateResource[] = [
  "account",
  "orders",
  "positions",
  "executions",
  "perpFunding",
  "walletFunding",
  "liquidations",
  "marginSettings",
];

export function queryKeyForResource(resource: PrivateResource) {
  switch (resource) {
    case "account":
      return queryKeys.account;
    case "orders":
      return queryKeys.orders.all;
    case "positions":
      return queryKeys.positions.all;
    case "executions":
      return queryKeys.executions.all;
    case "perpFunding":
      return queryKeys.perpFunding.all;
    case "walletFunding":
      return queryKeys.walletFunding.all;
    case "liquidations":
      return queryKeys.liquidations.all;
    case "marginSettings":
      return queryKeys.marginSettings.all;
  }
}

export function invalidatePrivateResources(
  queryClient: QueryClient,
  resources: PrivateResource[],
): void {
  for (const resource of resources) {
    void queryClient.invalidateQueries({ queryKey: queryKeyForResource(resource) });
  }
}

export function invalidateAllPrivateResources(queryClient: QueryClient): void {
  invalidatePrivateResources(queryClient, PRIVATE_RESOURCES);
}

export function invalidateAfterPlaceOrder(
  queryClient: QueryClient,
  status: "OPEN" | "FILLED" | "CANCELLED",
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.account });
  void queryClient.invalidateQueries({ queryKey: queryKeys.positions.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.perpFunding.all });

  if (status === "FILLED") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.executions.all });
  }
}

export function invalidateAfterCancel(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
}

export function invalidateAfterFaucet(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.account });
  void queryClient.invalidateQueries({ queryKey: queryKeys.walletFunding.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.positions.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.perpFunding.all });
}

export function invalidateAfterMargin(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.marginSettings.all });
}

export function invalidateAfterInitialize(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.account });
  void queryClient.invalidateQueries({ queryKey: queryKeys.walletFunding.all });
}
