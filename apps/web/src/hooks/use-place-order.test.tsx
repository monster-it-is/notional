import type { CreateOrderRequest } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlaceOrder } from "./use-place-order.ts";
import { placeOrder } from "../lib/api/orders.ts";

vi.mock("../lib/api/orders.ts", () => ({
  placeOrder: vi.fn(),
}));

const mockedPlace = vi.mocked(placeOrder);

const request: CreateOrderRequest = {
  type: "MARKET",
  symbol: "BTCUSDT",
  side: "SELL",
  quantity: "0.001",
  reduceOnly: true,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("usePlaceOrder", () => {
  beforeEach(() => {
    mockedPlace.mockReset();
  });

  it("keeps the failed intent through reset() so retrySameIntent reuses the key", async () => {
    mockedPlace.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => usePlaceOrder(), { wrapper });

    act(() => {
      result.current.place(request);
    });
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    const firstKey = mockedPlace.mock.calls[0]?.[1];

    act(() => {
      result.current.reset();
    });
    act(() => {
      result.current.retrySameIntent();
    });
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(2));
    expect(mockedPlace.mock.calls[1]?.[1]).toBe(firstKey);
  });

  it("mints a new key after beginFreshTicket even for the same payload", async () => {
    mockedPlace.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => usePlaceOrder(), { wrapper });

    act(() => {
      result.current.place(request);
    });
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    const firstKey = mockedPlace.mock.calls[0]?.[1];

    act(() => {
      result.current.beginFreshTicket();
    });
    act(() => {
      result.current.place(request);
    });
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(2));
    expect(mockedPlace.mock.calls[1]?.[1]).not.toBe(firstKey);
  });

  it("does not retry a discarded ticket intent", async () => {
    mockedPlace.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => usePlaceOrder(), { wrapper });

    act(() => {
      result.current.place(request);
    });
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.beginFreshTicket();
    });
    act(() => {
      result.current.retrySameIntent();
    });
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });
});
