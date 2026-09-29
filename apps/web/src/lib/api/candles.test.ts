import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CandleListResponse } from "@notional/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCandles, TRADE_CHART_INTERVAL, TRADE_CHART_LIMIT } from "./candles.ts";
import { apiRequest } from "./client.ts";
import { queryKeys } from "../query-keys.ts";

vi.mock("./client.ts", () => ({
  apiRequest: vi.fn(),
}));

const mockedRequest = vi.mocked(apiRequest);

const payload: CandleListResponse = {
  symbol: "BTCUSDT",
  interval: "15m",
  candles: [],
};

describe("getCandles", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockedRequest.mockResolvedValue(payload);
  });

  it("requests Notional historical candles for 15m and limit 500", async () => {
    await getCandles({
      symbol: "BTCUSDT",
      interval: TRADE_CHART_INTERVAL,
      limit: TRADE_CHART_LIMIT,
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/market-data/BTCUSDT/candles?interval=15m&limit=500",
    );
  });

  it("encodes the selected symbol in the path", async () => {
    await getCandles({ symbol: "ETHUSDT", interval: "15m", limit: 500 });

    expect(mockedRequest.mock.calls[0]?.[0]).toContain(
      `/api/market-data/${encodeURIComponent("ETHUSDT")}/candles`,
    );
  });

  it("does not contact Binance from the browser", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/api/candles.ts"), "utf8");
    expect(source).not.toMatch(/binance/i);
    expect(source).not.toMatch(/fstream/i);
    expect(source).not.toMatch(/fapi/i);
  });
});

describe("candle query keys", () => {
  it("separates historical queries by symbol", () => {
    const btc = queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: 500 });
    const eth = queryKeys.candles.list({ symbol: "ETHUSDT", interval: "15m", limit: 500 });

    expect(btc).not.toEqual(eth);
    expect(btc[0]).toBe("candles");
    expect(btc[1]).toBe("list");
  });
});
