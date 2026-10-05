import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CandleListResponse } from "@notional/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TRADE_CHART_INTERVAL,
  getCandles,
  historicalBackfillLimit,
  TRADE_CHART_LIMIT,
  TRADE_CHART_MAX_CANDLES,
} from "./candles.ts";
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

  it("requests Notional historical candles for the selected interval and limit 500", async () => {
    await getCandles({
      symbol: "BTCUSDT",
      interval: DEFAULT_TRADE_CHART_INTERVAL,
      limit: TRADE_CHART_LIMIT,
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/market-data/BTCUSDT/candles?interval=15m&limit=500",
    );
  });

  it("requests the selected 1h interval", async () => {
    await getCandles({ symbol: "BTCUSDT", interval: "1h", limit: 500 });

    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/market-data/BTCUSDT/candles?interval=1h&limit=500",
    );
  });

  it("serializes before when requesting older history", async () => {
    await getCandles({
      symbol: "BTCUSDT",
      interval: "15m",
      limit: 200,
      before: 1_499_040_000_000,
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/market-data/BTCUSDT/candles?interval=15m&limit=200&before=1499040000000",
    );
  });

  it("forwards an AbortSignal to apiRequest", async () => {
    const controller = new AbortController();
    await getCandles(
      { symbol: "BTCUSDT", interval: "15m", limit: 500, before: 1_499_040_000_000 },
      { signal: controller.signal },
    );

    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/market-data/BTCUSDT/candles?interval=15m&limit=500&before=1499040000000",
      { signal: controller.signal },
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

describe("historicalBackfillLimit", () => {
  it("requests a full page when remaining capacity is at least TRADE_CHART_LIMIT", () => {
    expect(historicalBackfillLimit(9_500)).toBe(TRADE_CHART_LIMIT);
  });

  it("requests only remaining capacity near the cap", () => {
    expect(historicalBackfillLimit(9_800)).toBe(200);
    expect(historicalBackfillLimit(9_999)).toBe(1);
  });

  it("requests nothing at the loaded-window cap", () => {
    expect(historicalBackfillLimit(TRADE_CHART_MAX_CANDLES)).toBe(0);
    expect(historicalBackfillLimit(TRADE_CHART_MAX_CANDLES + 1)).toBe(0);
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

  it("separates historical queries by interval", () => {
    const fifteen = queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: 500 });
    const hour = queryKeys.candles.list({ symbol: "BTCUSDT", interval: "1h", limit: 500 });

    expect(fifteen).not.toEqual(hour);
    expect(hour).toEqual(["candles", "list", { symbol: "BTCUSDT", interval: "1h", limit: 500 }]);
  });
});
