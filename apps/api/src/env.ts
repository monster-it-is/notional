import { parseConfiguredMoney, type MoneyDecimal } from "@notional/db";
import { z } from "zod";

const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  WEB_ORIGIN: z.url(),
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
});

export type ApiEnv = Omit<z.infer<typeof envSchema>, "FAUCET_AMOUNT"> & {
  FAUCET_AMOUNT: MoneyDecimal;
};

export function parseEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = envSchema.parse(source);

  return {
    ...parsed,
    FAUCET_AMOUNT: parseConfiguredMoney(parsed.FAUCET_AMOUNT),
  };
}

export const env = parseEnv();
