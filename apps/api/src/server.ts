import { closePool } from "@notional/db";
import { fromNodeHeaders } from "better-auth/node";

import { buildApp } from "./app.js";
import { auth } from "./auth.js";
import { env } from "./env.js";
import { createLoggerProxy, unknownErrorLogFields } from "./logging.js";
import { createMarketDataRuntime } from "./market-data/coordinator.js";
import { createBinanceRestClient } from "./market-data/rest-client.js";
import { createRealtimeRuntime, latestFromStore } from "./realtime/runtime.js";
import { markRuntimeReady } from "./runtime-status.js";
import { createFundingScanner } from "./services/funding-scanner.js";
import { createLimitOrderMatcher } from "./services/limit-matcher.js";
import { createLiquidationScanner } from "./services/liquidation-scanner.js";
import { bindFastifyLogger, shutdownOnce } from "./shutdown.js";

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

  app.addHook("onReady", async () => {
    await marketData.start();
    scanner.start();
    fundingScanner.start();
    markRuntimeReady();
    app.log.info("runtime ready");
  });

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
      exit: (code) => {
        process.exit(code);
      },
    });

  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });

  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0",
    });
    app.log.info({ port: env.PORT }, "api listening");
  } catch (error) {
    app.log.error(unknownErrorLogFields(error), "api listen failed");
    process.exit(1);
  }
}

void startServer();
