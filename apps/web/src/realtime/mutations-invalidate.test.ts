import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "../lib/query-keys.ts";
import {
  invalidateAfterCancel,
  invalidateAfterFaucet,
  invalidateAfterInitialize,
  invalidateAfterMargin,
} from "./invalidate.ts";

describe("other mutation invalidation", () => {
  it("cancel invalidates orders", () => {
    const seen = capture();
    invalidateAfterCancel(seen.client);
    expect(seen.keys).toEqual([JSON.stringify(queryKeys.orders.all)]);
  });

  it("faucet invalidates account, walletFunding, positions, perpFunding", () => {
    const seen = capture();
    invalidateAfterFaucet(seen.client);
    expect(seen.keys).toEqual(
      [
        queryKeys.account,
        queryKeys.walletFunding.all,
        queryKeys.positions.all,
        queryKeys.perpFunding.all,
      ].map((key) => JSON.stringify(key)),
    );
  });

  it("margin invalidates marginSettings", () => {
    const seen = capture();
    invalidateAfterMargin(seen.client);
    expect(seen.keys).toEqual([JSON.stringify(queryKeys.marginSettings.all)]);
  });

  it("initialize invalidates account and walletFunding", () => {
    const seen = capture();
    invalidateAfterInitialize(seen.client);
    expect(seen.keys).toEqual(
      [queryKeys.account, queryKeys.walletFunding.all].map((key) => JSON.stringify(key)),
    );
  });
});

function capture() {
  const client = new QueryClient();
  const keys: string[] = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters) => {
    keys.push(JSON.stringify(filters?.queryKey));
    return original(filters);
  }) as typeof client.invalidateQueries;
  return { client, keys };
}
