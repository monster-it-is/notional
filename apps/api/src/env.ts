import { parseConfiguredMoney, type MoneyDecimal } from "@notional/db";
import { z } from "zod";

const EXAMPLE_AUTH_SECRET = "replace-with-a-32-character-or-longer-secret";
const NODE_ENVS = ["development", "test", "production"] as const;
const PINO_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const ORIGIN_SCHEMES = new Set(["http:", "https:"]);
const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().min(1),
  WEB_ORIGIN: z.string().min(1),
  FAUCET_AMOUNT: z.string().min(1),
  BINANCE_FAPI_REST_BASE_URL: z.url().default("https://fapi.binance.com"),
  BINANCE_FAPI_MARKET_WS_BASE_URL: z.url().default("wss://fstream.binance.com/market"),
  BINANCE_FAPI_PUBLIC_WS_BASE_URL: z.url().default("wss://fstream.binance.com/public"),
  BINANCE_HTTP_TIMEOUT_MS: positiveInt.default(10_000),
  INSTRUMENT_SYNC_INTERVAL_MS: positiveInt.default(3_600_000),
  MARKET_DATA_MARK_STALE_MS: positiveInt.default(10_000),
  MARKET_DATA_BOOK_STALE_MS: positiveInt.default(10_000),
  BINANCE_WS_RECONNECT_MAX_MS: positiveInt.default(30_000),
  LIQUIDATION_SCAN_INTERVAL_MS: positiveInt.default(1_000),
  FUNDING_SCAN_INTERVAL_MS: positiveInt.default(5_000),
  WS_MARKET_COALESCE_MS: positiveInt.default(100),
  WS_IDLE_TIMEOUT_MS: positiveInt.default(45_000),
  LOG_LEVEL: z.enum(PINO_LEVELS).optional(),
  TRUST_PROXY: z.string().optional(),
  DATABASE_POOL_MAX: positiveInt.default(10),
  SHUTDOWN_TIMEOUT_MS: positiveInt.default(15_000),
  ENABLE_HSTS: z.string().optional(),
  NODE_ENV: z.enum(NODE_ENVS).optional(),
});

export type NodeEnv = (typeof NODE_ENVS)[number];
export type TrustProxySetting = boolean | number;

export type ApiEnv = Omit<
  z.infer<typeof envSchema>,
  | "FAUCET_AMOUNT"
  | "BETTER_AUTH_URL"
  | "WEB_ORIGIN"
  | "TRUST_PROXY"
  | "ENABLE_HSTS"
  | "LOG_LEVEL"
  | "NODE_ENV"
> & {
  FAUCET_AMOUNT: MoneyDecimal;
  BETTER_AUTH_URL: string;
  WEB_ORIGIN: string;
  TRUST_PROXY: TrustProxySetting;
  ENABLE_HSTS: boolean;
  LOG_LEVEL: (typeof PINO_LEVELS)[number];
  NODE_ENV: NodeEnv;
};

export function parseEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = envSchema.parse(source);
  const nodeEnv = parsed.NODE_ENV ?? "development";
  const production = nodeEnv === "production";
  const betterAuthUrl = canonicalizeOrigin(parsed.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  const webOrigin = canonicalizeOrigin(parsed.WEB_ORIGIN, "WEB_ORIGIN");

  assertPostgresUrl(parsed.DATABASE_URL);

  if (production) {
    assertProductionDatabaseUrl(parsed.DATABASE_URL);
    assertProductionSecret(parsed.BETTER_AUTH_SECRET);
    assertProductionHttpsOrigin(betterAuthUrl, "BETTER_AUTH_URL");
    assertProductionHttpsOrigin(webOrigin, "WEB_ORIGIN");
  }

  return {
    ...parsed,
    NODE_ENV: nodeEnv,
    BETTER_AUTH_URL: betterAuthUrl,
    WEB_ORIGIN: webOrigin,
    FAUCET_AMOUNT: parseConfiguredMoney(parsed.FAUCET_AMOUNT),
    TRUST_PROXY: parseTrustProxy(parsed.TRUST_PROXY),
    ENABLE_HSTS: parseEnableHsts(parsed.ENABLE_HSTS, production, betterAuthUrl),
    LOG_LEVEL: parsed.LOG_LEVEL ?? (production ? "info" : "debug"),
  };
}

export const env = parseEnv();

export function canonicalizeOrigin(value: string, name: string): string {
  if (value.includes(",")) {
    throw new Error(`${name} must be an exact single origin`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL origin`);
  }

  if (!ORIGIN_SCHEMES.has(parsed.protocol)) {
    throw new Error(`${name} must use http or https`);
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${name} must not include credentials`);
  }

  if (parsed.search !== "") {
    throw new Error(`${name} must not include a query`);
  }

  if (parsed.hash !== "") {
    throw new Error(`${name} must not include a hash`);
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(`${name} must not include a path`);
  }

  return parsed.origin;
}

function assertPostgresUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres: or postgresql:");
  }
}

function assertProductionDatabaseUrl(value: string): void {
  const parsed = new URL(value);
  const databaseName = parsed.pathname.replace(/^\//, "").split("/")[0] ?? "";
  if (databaseName === "notional_test") {
    throw new Error("production DATABASE_URL must not use the test database");
  }
}

function assertProductionSecret(secret: string): void {
  if (secret === EXAMPLE_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET must not use the example placeholder");
  }
}

function assertProductionHttpsOrigin(value: string, name: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use https in production`);
  }

  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    throw new Error(`${name} must not use localhost in production`);
  }
}

export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  if (value === undefined || value === "" || value === "false" || value === "0") {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (/^[1-9]\d*$/.test(value)) {
    return Number(value);
  }

  throw new Error("TRUST_PROXY must be false, 0, true, or a positive hop count");
}

function parseEnableHsts(
  value: string | undefined,
  production: boolean,
  betterAuthUrl: string,
): boolean {
  if (value === undefined || value === "") {
    return production && new URL(betterAuthUrl).protocol === "https:";
  }

  if (value === "false" || value === "0") {
    return false;
  }

  if (value === "true" || value === "1") {
    return production && new URL(betterAuthUrl).protocol === "https:";
  }

  throw new Error("ENABLE_HSTS must be true, false, 1, or 0");
}
