import { fromNodeHeaders } from "better-auth/node";

import { buildApp } from "./app.js";
import { auth } from "./auth.js";
import { env } from "./env.js";
import { createMarketDataRuntime } from "./market-data/coordinator.js";
import type { Logger } from "./market-data/types.js";
import { createBinanceRestClient } from "./market-data/rest-client.js";
import { createRealtimeRuntime, latestFromStore } from "./realtime/runtime.js";
import { createFundingScanner } from "./services/funding-scanner.js";
import { createLimitOrderMatcher } from "./services/limit-matcher.js";
import { createLiquidationScanner } from "./services/liquidation-scanner.js";

const logger: Logger = {
  info() {},
  warn(message, extra) {
    console.warn(message, extra ?? "");
  },
  error(message, extra) {
    console.error(message, extra ?? "");
  },
};

const start = async () => {
  let notifyAcceptedBook: (symbol: string) => void = () => {};
  let notifyAcceptedMark: (symbol: string) => void = () => {};
  const marketData = createMarketDataRuntime({
    env,
    onAcceptedBook(symbol) {
      notifyAcceptedBook(symbol);
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

  app.addHook("onReady", async () => {
    await marketData.start();
    scanner.start();
    fundingScanner.start();
  });

  app.addHook("onClose", async () => {
    fundingScanner.stop();
    scanner.stop();
    await realtime.shutdown();
    await marketData.stop();
  });

  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
