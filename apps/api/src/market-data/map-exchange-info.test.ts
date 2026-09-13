import { describe, expect, it } from "vitest";

import { mapExchangeInfo } from "./map-exchange-info.js";
import { coin, requiredFilters } from "./exchange-info-fixtures.js";

describe("mapExchangeInfo", () => {
  it("maps an eligible COIN USDT perpetual", () => {
    const mapped = mapExchangeInfo({
      symbols: [coin("BTCUSDT")],
    });

    expect(mapped).toEqual({
      ok: true,
      instruments: [
        expect.objectContaining({
          symbol: "BTCUSDT",
          baseAsset: "BTC",
          status: "ACTIVE",
          tickSize: "0.1",
          minNotional: "50",
          marketMinQty: "0.001",
        }),
      ],
    });
  });

  it("skips non-USDT quote, non-USDT margin, non-perpetual, non-COIN, and TradFi", () => {
    const mapped = mapExchangeInfo({
      symbols: [
        coin("BTCUSDT"),
        coin("ETHUSDC", { quoteAsset: "USDC", marginAsset: "USDC" }),
        coin("XBTUSDT", { marginAsset: "BTC" }),
        coin("BTCUSDT_Q", { contractType: "CURRENT_QUARTER" }),
        coin("BTCDOMUSDT", { underlyingType: "INDEX" }),
        coin("MSTRUSDT", {
          contractType: "TRADIFI_PERPETUAL",
          underlyingType: "EQUITY",
          baseAsset: "MSTR",
        }),
        coin("OPENAIUSDT", {
          contractType: "TRADIFI_PERPETUAL",
          underlyingType: "PREMARKET",
          baseAsset: "OPENAI",
        }),
      ],
    });

    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.instruments.map((row) => row.symbol)).toEqual(["BTCUSDT"]);
    }
  });

  it("maps non-TRADING eligible contracts as INACTIVE", () => {
    const mapped = mapExchangeInfo({
      symbols: [coin("SOLUSDT", { status: "SETTLING" })],
    });

    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.instruments[0]?.status).toBe("INACTIVE");
    }
  });

  it("ignores unknown non-required filters", () => {
    const mapped = mapExchangeInfo({
      symbols: [
        coin("BTCUSDT", {
          filters: [
            ...requiredFilters(),
            { filterType: "PERCENT_PRICE", multiplierUp: "1.05" },
            { filterType: "POSITION_RISK_CONTROL", positionControlSide: "NONE" },
          ],
        }),
      ],
    });

    expect(mapped.ok).toBe(true);
  });

  it("preserves PRICE_FILTER zeros", () => {
    const mapped = mapExchangeInfo({
      symbols: [
        coin("BTCUSDT", {
          filters: [
            { filterType: "PRICE_FILTER", minPrice: "0", maxPrice: "0", tickSize: "0" },
            lot(),
            marketLot(),
            { filterType: "MIN_NOTIONAL", notional: "5" },
          ],
        }),
      ],
    });

    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.instruments[0]?.tickSize).toBe("0");
      expect(mapped.instruments[0]?.minPrice).toBe("0");
      expect(mapped.instruments[0]?.maxPrice).toBe("0");
    }
  });

  it("maps MIN_NOTIONAL.notional to minNotional", () => {
    const mapped = mapExchangeInfo({
      symbols: [coin("BTCUSDT")],
    });

    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.instruments[0]?.minNotional).toBe("50");
    }
  });

  it("aborts when an eligible candidate is missing a required filter", () => {
    const mapped = mapExchangeInfo({
      symbols: [
        coin("ETHUSDT"),
        coin("BTCUSDT", {
          filters: [lot(), marketLot(), { filterType: "MIN_NOTIONAL", notional: "50" }],
        }),
      ],
    });

    expect(mapped).toEqual({
      ok: false,
      reason: "malformed_candidate",
      detail: "eligible symbol BTCUSDT is missing a valid PRICE_FILTER",
    });
  });

  it("aborts when MIN_NOTIONAL uses minNotional instead of notional", () => {
    const mapped = mapExchangeInfo({
      symbols: [
        coin("BTCUSDT", {
          filters: [
            price(),
            lot(),
            marketLot(),
            { filterType: "MIN_NOTIONAL", minNotional: "50" },
          ],
        }),
      ],
    });

    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.reason).toBe("malformed_candidate");
    }
  });

  it("returns empty when the snapshot has no eligible instruments", () => {
    const mapped = mapExchangeInfo({
      symbols: [
        coin("MSTRUSDT", {
          contractType: "TRADIFI_PERPETUAL",
          underlyingType: "EQUITY",
        }),
      ],
    });

    expect(mapped).toEqual({
      ok: false,
      reason: "empty",
      detail: "exchangeInfo contained no eligible COIN USDT perpetuals",
    });
  });

  it("rejects a payload that is not an exchangeInfo snapshot", () => {
    expect(mapExchangeInfo({ timezone: "UTC" })).toEqual({
      ok: false,
      reason: "invalid_snapshot",
      detail: "exchangeInfo is missing a symbols array",
    });
  });
});

function price() {
  return {
    filterType: "PRICE_FILTER",
    minPrice: "0.1",
    maxPrice: "1000000",
    tickSize: "0.1",
  };
}

function lot() {
  return {
    filterType: "LOT_SIZE",
    minQty: "0.001",
    maxQty: "1000",
    stepSize: "0.001",
  };
}

function marketLot() {
  return {
    filterType: "MARKET_LOT_SIZE",
    minQty: "0.001",
    maxQty: "120",
    stepSize: "0.001",
  };
}
