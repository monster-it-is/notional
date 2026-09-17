import { describe, expect, it } from "vitest";

import { parseEnv, parseTrustProxy } from "./env.js";

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

  it("defaults LIQUIDATION_SCAN_INTERVAL_MS to 1000 and rejects non-positive values", () => {
    const source = { ...process.env };
    delete source.LIQUIDATION_SCAN_INTERVAL_MS;
    expect(parseEnv(source).LIQUIDATION_SCAN_INTERVAL_MS).toBe(1_000);
    expect(() => parseEnv({ ...process.env, LIQUIDATION_SCAN_INTERVAL_MS: "0" })).toThrow();
    expect(() => parseEnv({ ...process.env, LIQUIDATION_SCAN_INTERVAL_MS: "-1" })).toThrow();
  });

  it("defaults FUNDING_SCAN_INTERVAL_MS to 5000 and rejects non-positive values", () => {
    const source = { ...process.env };
    delete source.FUNDING_SCAN_INTERVAL_MS;
    expect(parseEnv(source).FUNDING_SCAN_INTERVAL_MS).toBe(5_000);
    expect(() => parseEnv({ ...process.env, FUNDING_SCAN_INTERVAL_MS: "0" })).toThrow();
    expect(() => parseEnv({ ...process.env, FUNDING_SCAN_INTERVAL_MS: "-1" })).toThrow();
  });

  it("defaults WebSocket coalesce and idle timeouts", () => {
    const source = { ...process.env };
    delete source.WS_MARKET_COALESCE_MS;
    delete source.WS_IDLE_TIMEOUT_MS;
    expect(parseEnv(source).WS_MARKET_COALESCE_MS).toBe(100);
    expect(parseEnv(source).WS_IDLE_TIMEOUT_MS).toBe(45_000);
    expect(() => parseEnv({ ...process.env, WS_MARKET_COALESCE_MS: "0" })).toThrow();
    expect(() => parseEnv({ ...process.env, WS_IDLE_TIMEOUT_MS: "-1" })).toThrow();
  });

  it("rejects invalid Binance URLs", () => {
    expect(() =>
      parseEnv({ ...process.env, BINANCE_FAPI_REST_BASE_URL: "not-a-url" }),
    ).toThrow();
  });

  it("defaults TRUST_PROXY to false and keeps local development usable", () => {
    const source = { ...process.env };
    delete source.TRUST_PROXY;
    delete source.ENABLE_HSTS;
    delete source.NODE_ENV;
    const parsed = parseEnv(source);
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.TRUST_PROXY).toBe(false);
    expect(parsed.ENABLE_HSTS).toBe(false);
    expect(parsed.LOG_LEVEL).toBe("debug");
    expect(parsed.WEB_ORIGIN.endsWith("/")).toBe(false);
    expect(parseEnv({ ...source, ENABLE_HSTS: "true" }).ENABLE_HSTS).toBe(false);
    expect(parseEnv({ ...source, ENABLE_HSTS: "1" }).ENABLE_HSTS).toBe(false);
  });

  it("rejects malformed NODE_ENV, ENABLE_HSTS, LOG_LEVEL, and TRUST_PROXY", () => {
    expect(() => parseEnv({ ...process.env, NODE_ENV: "prodution" })).toThrow();
    expect(() => parseEnv({ ...process.env, ENABLE_HSTS: "yes" })).toThrow(/ENABLE_HSTS/);
    expect(() => parseEnv({ ...process.env, LOG_LEVEL: "verbose" })).toThrow();
    expect(() => parseEnv({ ...process.env, TRUST_PROXY: "yes" })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv({ ...process.env, TRUST_PROXY: "1.5" })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv({ ...process.env, TRUST_PROXY: "10.0.0.1" })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv({ ...process.env, TRUST_PROXY: "0" })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv({ ...process.env, TRUST_PROXY: "1" })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv({ ...process.env, TRUST_PROXY: "2" })).toThrow(/TRUST_PROXY/);
  });

  it("parses TRUST_PROXY as false or true only", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseEnv({ ...process.env, TRUST_PROXY: "false" }).TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...process.env, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
  });

  it("rejects a short BETTER_AUTH_SECRET", () => {
    expect(() => parseEnv({ ...process.env, BETTER_AUTH_SECRET: "too-short" })).toThrow();
  });

  it("normalizes root trailing slashes and rejects non-origin WEB_ORIGIN and BETTER_AUTH_URL", () => {
    expect(parseEnv({ ...process.env, WEB_ORIGIN: "http://localhost:5173/" }).WEB_ORIGIN).toBe(
      "http://localhost:5173",
    );
    expect(
      parseEnv({ ...process.env, BETTER_AUTH_URL: "http://localhost:3000/" }).BETTER_AUTH_URL,
    ).toBe("http://localhost:3000");

    expect(() =>
      parseEnv({ ...process.env, WEB_ORIGIN: "http://localhost:5173/app" }),
    ).toThrow(/path/);
    expect(() =>
      parseEnv({ ...process.env, WEB_ORIGIN: "http://localhost:5173/?q=1" }),
    ).toThrow(/query/);
    expect(() =>
      parseEnv({ ...process.env, WEB_ORIGIN: "http://localhost:5173/#x" }),
    ).toThrow(/hash/);
    expect(() =>
      parseEnv({ ...process.env, WEB_ORIGIN: "http://user:pass@localhost:5173" }),
    ).toThrow(/credentials/);
    expect(() => parseEnv({ ...process.env, WEB_ORIGIN: "ftp://localhost:5173" })).toThrow(
      /http or https/,
    );

    expect(() =>
      parseEnv({ ...process.env, BETTER_AUTH_URL: "http://localhost:3000/api/auth" }),
    ).toThrow(/path/);
    expect(() =>
      parseEnv({ ...process.env, BETTER_AUTH_URL: "http://localhost:3000/?q=1" }),
    ).toThrow(/query/);
    expect(() =>
      parseEnv({ ...process.env, BETTER_AUTH_URL: "http://localhost:3000/#x" }),
    ).toThrow(/hash/);
    expect(() =>
      parseEnv({ ...process.env, BETTER_AUTH_URL: "http://user:pass@localhost:3000" }),
    ).toThrow(/credentials/);
  });

  it("rejects production localhost, http origins, placeholder secrets, and the test database", () => {
    const production = productionEnv();
    expect(() => parseEnv({ ...production, BETTER_AUTH_URL: "http://api.example.com" })).toThrow(
      /https/,
    );
    expect(() => parseEnv({ ...production, WEB_ORIGIN: "http://app.example.com" })).toThrow(
      /https/,
    );
    expect(() =>
      parseEnv({ ...production, BETTER_AUTH_URL: "https://localhost:3000" }),
    ).toThrow(/localhost/);
    expect(() => parseEnv({ ...production, WEB_ORIGIN: "https://localhost:5173" })).toThrow(
      /localhost/,
    );
    expect(() =>
      parseEnv({ ...production, BETTER_AUTH_URL: "https://127.0.0.1" }),
    ).toThrow(/localhost/);
    expect(() => parseEnv({ ...production, WEB_ORIGIN: "https://127.0.0.1" })).toThrow(
      /localhost/,
    );
    expect(() => parseEnv({ ...production, BETTER_AUTH_URL: "https://[::1]" })).toThrow(
      /localhost/,
    );
    expect(() => parseEnv({ ...production, WEB_ORIGIN: "https://[::1]" })).toThrow(
      /localhost/,
    );
    expect(() =>
      parseEnv({
        ...production,
        BETTER_AUTH_SECRET: "replace-with-a-32-character-or-longer-secret",
      }),
    ).toThrow(/placeholder/);
    expect(() =>
      parseEnv({
        ...production,
        DATABASE_URL: "postgresql://notional:notional@db.example.com/notional_test",
      }),
    ).toThrow(/test database/);
    expect(() => parseEnv({ ...production, WEB_ORIGIN: "https://a.com,https://b.com" })).toThrow(
      /single origin/,
    );
  });

  it("accepts production https config and preserves DATABASE_URL query parameters", () => {
    const url = "postgresql://notional:notional@db.example.com:5432/notional?sslmode=require";
    const parsed = parseEnv({
      ...productionEnv(),
      DATABASE_URL: url,
    });
    expect(parsed.DATABASE_URL).toBe(url);
    expect(parsed.NODE_ENV).toBe("production");
    expect(parsed.ENABLE_HSTS).toBe(true);
    expect(parsed.LOG_LEVEL).toBe("info");
    expect(parsed.WEB_ORIGIN).toBe("https://app.example.com");
    expect(parsed.BETTER_AUTH_URL).toBe("https://api.example.com");
    expect(parsed.TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...productionEnv(), ENABLE_HSTS: "false" }).ENABLE_HSTS).toBe(false);
    expect(parseEnv({ ...productionEnv(), ENABLE_HSTS: "0" }).ENABLE_HSTS).toBe(false);
  });
});

function productionEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://notional:notional@db.example.com:5432/notional",
    BETTER_AUTH_SECRET: "production-secret-value-at-least-32-chars",
    BETTER_AUTH_URL: "https://api.example.com",
    WEB_ORIGIN: "https://app.example.com/",
    FAUCET_AMOUNT: "100",
  };
}
