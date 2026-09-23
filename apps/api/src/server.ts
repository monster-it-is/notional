import { closePool } from "@notional/db";
import { fromNodeHeaders } from "better-auth/node";

import { buildApp } from "./app.js";
import { auth } from "./auth.js";
import { env } from "./env.js";
import { createLoggerProxy } from "./logging.js";
import { createMarketDataRuntime } from "./market-data/coordinator.js";
import { createBinanceRestClient } from "./market-data/rest-client.js";
import { createRealtimeRuntime, latestFromStore } from "./realtime/runtime.js";
import { createFundingScanner } from "./services/funding-scanner.js";
import {
  createLimitOrderMatcher,
  DEFAULT_MAX_CONCURRENT_SYMBOL_CYCLES,
} from "./services/limit-matcher.js";
import { createLiquidationScanner } from "./services/liquidation-scanner.js";
import { bindFastifyLogger, shutdownOnce } from "./shutdown.js";
import { listenThenBootstrapRuntime } from "./startup.js";

const logger = createLoggerProxy();

export async function startServer(): Promise<void> {
  let tickSchedulingEnabled = true;
  let notifyAcceptedBook: (symbol: string) => void = () => {};
  let notifyAcceptedMark: (symbol: string) => void = () => {};
  const marketData = createMarketDataRuntime({
    env,
    logger,
    onAcceptedBook(symbol) {
      if (tickSchedulingEnabled) {
        notifyAcceptedBook(symbol);
      }
    },
    onAcceptedMark(symbol) {
      notifyAcceptedMark(symbol);
    },
  });
  const realtime = createRealtimeRuntime({
    latest: latestFromStore(marketData.store),
    coalesceMs: env.WS_MARKET_COALESCE_MS,
    idleTimeoutMs: env.WS_IDLE_TIMEOUT_MS,
    logger,
    async getSession(headers) {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(headers),
      });
      return session ? { userId: session.user.id } : null;
    },
  });
  const matcher = createLimitOrderMatcher({
    marketData,
    logger,
    maxConcurrentSymbols: DEFAULT_MAX_CONCURRENT_SYMBOL_CYCLES,
    onPrivateCommitted: (effect) => realtime.onPrivateCommitted(effect),
  });
  const scanner = createLiquidationScanner({
    marketData,
    intervalMs: env.LIQUIDATION_SCAN_INTERVAL_MS,
    logger,
    onPrivateCommitted: (effect) => realtime.onPrivateCommitted(effect),
  });
  const fundingScanner = createFundingScanner({
    rest: createBinanceRestClient({
      restBaseUrl: env.BINANCE_FAPI_REST_BASE_URL,
      timeoutMs: env.BINANCE_HTTP_TIMEOUT_MS,
    }),
    marketData,
    intervalMs: env.FUNDING_SCAN_INTERVAL_MS,
    logger,
    onSettled: () => scanner.requestScan(),
    onPrivateCommitted: (effect) => realtime.onPrivateCommitted(effect),
  });
  notifyAcceptedBook = (symbol) => {
    matcher.schedule(symbol);
    realtime.noteBook(symbol);
  };
  notifyAcceptedMark = (symbol) => {
    realtime.noteMark(symbol);
  };
  const app = await buildApp({
    marketData,
    realtime,
    onOpenOrderCommitted: (symbol) => matcher.schedule(symbol),
    onPrivateCommitted: (effect) => realtime.onPrivateCommitted(effect),
  });
  bindFastifyLogger(logger, app);

  const exit = (code: number) => {
    process.exit(code);
  };
  const shutdown = () =>
    shutdownOnce({
      app,
      matcher,
      fundingScanner,
      liquidationScanner: scanner,
      realtime,
      marketData,
      disableTickScheduling: () => {
        tickSchedulingEnabled = false;
      },
      timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
      logger,
      closePool,
      exit,
    });

  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });

  await listenThenBootstrapRuntime({
    app,
    port: env.PORT,
    marketData,
    liquidationScanner: scanner,
    fundingScanner,
    shutdown,
    exit,
  });
}

void startServer();
