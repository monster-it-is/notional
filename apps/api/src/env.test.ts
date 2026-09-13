import { describe, expect, it } from "vitest";

import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("parses FAUCET_AMOUNT as a MoneyDecimal", () => {
    const parsed = parseEnv(process.env);

    expect(parsed.FAUCET_AMOUNT.isPositive()).toBe(true);
    expect(typeof parsed.FAUCET_AMOUNT.toString()).toBe("string");
  });

  it("rejects missing and empty FAUCET_AMOUNT", () => {
    const missing = { ...process.env };
    delete missing.FAUCET_AMOUNT;

    expect(() => parseEnv(missing)).toThrow();
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "" })).toThrow();
  });

  it("rejects invalid FAUCET_AMOUNT values", () => {
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "0" })).toThrow(
      "configured money must be a positive decimal",
    );
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "-1" })).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "1e2" })).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "abc" })).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() =>
      parseEnv({ ...process.env, FAUCET_AMOUNT: "1.1234567890123456789" }),
    ).toThrow("financial value exceeds 18 decimal places");
    expect(() =>
      parseEnv({ ...process.env, FAUCET_AMOUNT: `1${"0".repeat(20)}` }),
    ).toThrow("financial value exceeds NUMERIC(38,18) precision");
  });

  it("applies Binance market-data defaults", () => {
    const source = { ...process.env };
    delete source.BINANCE_FAPI_REST_BASE_URL;
    delete source.BINANCE_FAPI_MARKET_WS_BASE_URL;
    delete source.BINANCE_FAPI_PUBLIC_WS_BASE_URL;
    delete source.MARKET_DATA_MARK_STALE_MS;
    delete source.MARKET_DATA_BOOK_STALE_MS;

    const parsed = parseEnv(source);

    expect(parsed.BINANCE_FAPI_REST_BASE_URL).toBe("https://fapi.binance.com");
    expect(parsed.BINANCE_FAPI_MARKET_WS_BASE_URL).toBe("wss://fstream.binance.com/market");
    expect(parsed.BINANCE_FAPI_PUBLIC_WS_BASE_URL).toBe("wss://fstream.binance.com/public");
    expect(parsed.MARKET_DATA_MARK_STALE_MS).toBe(10_000);
    expect(parsed.MARKET_DATA_BOOK_STALE_MS).toBe(10_000);
  });

  it("rejects invalid Binance URLs", () => {
    expect(() =>
      parseEnv({ ...process.env, BINANCE_FAPI_REST_BASE_URL: "not-a-url" }),
    ).toThrow();
  });
});
