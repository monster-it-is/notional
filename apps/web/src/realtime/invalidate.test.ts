import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "../lib/query-keys.ts";
import {
  invalidateAfterPlaceOrder,
  invalidateAllPrivateResources,
  invalidatePrivateResources,
  PRIVATE_RESOURCES,
  queryKeyForResource,
} from "./invalidate.ts";

describe("private invalidation", () => {
  it("maps every PrivateResource to a query prefix", () => {
    expect(queryKeyForResource("account")).toEqual(queryKeys.account);
    expect(queryKeyForResource("orders")).toEqual(queryKeys.orders.all);
    expect(queryKeyForResource("positions")).toEqual(queryKeys.positions.all);
    expect(queryKeyForResource("executions")).toEqual(queryKeys.executions.all);
    expect(queryKeyForResource("perpFunding")).toEqual(queryKeys.perpFunding.all);
    expect(queryKeyForResource("walletFunding")).toEqual(queryKeys.walletFunding.all);
    expect(queryKeyForResource("liquidations")).toEqual(queryKeys.liquidations.all);
    expect(queryKeyForResource("marginSettings")).toEqual(queryKeys.marginSettings.all);
    expect(PRIVATE_RESOURCES).toHaveLength(8);
  });

  it("invalidates each resource in a multi-resource event", () => {
    const client = new QueryClient();
    const seen: string[] = [];
    const original = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters) => {
      seen.push(JSON.stringify(filters?.queryKey));
      return original(filters);
    }) as typeof client.invalidateQueries;

    invalidatePrivateResources(client, ["orders", "account", "positions"]);
    expect(seen).toContain(JSON.stringify(queryKeys.orders.all));
    expect(seen).toContain(JSON.stringify(queryKeys.account));
    expect(seen).toContain(JSON.stringify(queryKeys.positions.all));
  });

  it("reconnect invalidates all eight private groups", () => {
    const client = new QueryClient();
    const seen: string[] = [];
    const original = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters) => {
      seen.push(JSON.stringify(filters?.queryKey));
      return original(filters);
    }) as typeof client.invalidateQueries;

    invalidateAllPrivateResources(client);
    expect(seen).toHaveLength(8);
  });

  it("invalidates orders/account/positions/perpFunding after any successful place", () => {
    const client = new QueryClient();
    const seen: string[] = [];
    const original = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters) => {
      seen.push(JSON.stringify(filters?.queryKey));
      return original(filters);
    }) as typeof client.invalidateQueries;

    invalidateAfterPlaceOrder(client, "OPEN");
    expect(seen).toEqual(
      [
        queryKeys.orders.all,
        queryKeys.account,
        queryKeys.positions.all,
        queryKeys.perpFunding.all,
      ].map((key) => JSON.stringify(key)),
    );
  });

  it("also invalidates executions for FILLED placements", () => {
    const client = new QueryClient();
    const seen: string[] = [];
    const original = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters) => {
      seen.push(JSON.stringify(filters?.queryKey));
      return original(filters);
    }) as typeof client.invalidateQueries;

    invalidateAfterPlaceOrder(client, "FILLED");
    expect(seen).toContain(JSON.stringify(queryKeys.executions.all));
  });
});
