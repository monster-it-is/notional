import { describe, expect, it } from "vitest";

import { createBinanceRestClient } from "./rest-client.js";

describe("createBinanceRestClient getKlines", () => {
  it("omits endTime and startTime when endTime is not supplied", async () => {
    const urls: string[] = [];
    const rest = createBinanceRestClient({
      restBaseUrl: "https://fapi.binance.com",
      timeoutMs: 1_000,
      maxRetries: 1,
      fetchImpl: async (url) => {
        urls.push(String(url));
        return jsonResponse([]);
      },
    });

    await rest.getKlines({ symbol: "BTCUSDT", interval: "15m", limit: 500 });

    expect(urls).toEqual([
      "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=500",
    ]);
    expect(urls[0]).not.toContain("endTime");
    expect(urls[0]).not.toContain("startTime");
  });

  it("serializes endTime when supplied and does not add startTime", async () => {
    const urls: string[] = [];
    const rest = createBinanceRestClient({
      restBaseUrl: "https://fapi.binance.com",
      timeoutMs: 1_000,
      maxRetries: 1,
      fetchImpl: async (url) => {
        urls.push(String(url));
        return jsonResponse([]);
      },
    });

    await rest.getKlines({
      symbol: "BTCUSDT",
      interval: "15m",
      limit: 500,
      endTime: 1_499_039_999_999,
    });

    expect(urls).toEqual([
      "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=500&endTime=1499039999999",
    ]);
    expect(urls[0]).not.toContain("startTime");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
