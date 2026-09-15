import { buildApp } from "./app.js";
import { env } from "./env.js";
import { createMarketDataRuntime } from "./market-data/coordinator.js";
import type { Logger } from "./market-data/types.js";
import { createLimitOrderMatcher } from "./services/limit-matcher.js";
import { createFundingScanner } from "./services/funding-scanner.js";
import { createLiquidationScanner } from "./services/liquidation-scanner.js";
import { createBinanceRestClient } from "./market-data/rest-client.js";

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
  const marketData = createMarketDataRuntime({
    env,
    onAcceptedBook(symbol) {
      notifyAcceptedBook(symbol);
    },
  });
  const matcher = createLimitOrderMatcher({ marketData, logger });
  const scanner = createLiquidationScanner({
    marketData,
    intervalMs: env.LIQUIDATION_SCAN_INTERVAL_MS,
    logger,
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
  });
  notifyAcceptedBook = (symbol) => matcher.schedule(symbol);
  const app = await buildApp({
    marketData,
    onOpenOrderCommitted: (symbol) => matcher.schedule(symbol),
  });

  app.addHook("onReady", async () => {
    await marketData.start();
    scanner.start();
    fundingScanner.start();
  });

  app.addHook("onClose", async () => {
    fundingScanner.stop();
    scanner.stop();
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
