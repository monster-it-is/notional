import { buildApp } from "./app.js";
import { env } from "./env.js";
import { createMarketDataRuntime } from "./market-data/coordinator.js";
import type { Logger } from "./market-data/types.js";
import { createLimitOrderMatcher } from "./services/limit-matcher.js";

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
  notifyAcceptedBook = (symbol) => matcher.schedule(symbol);
  const app = await buildApp({
    marketData,
    onOpenOrderCommitted: (symbol) => matcher.schedule(symbol),
  });

  app.addHook("onReady", async () => {
    await marketData.start();
  });

  app.addHook("onClose", async () => {
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
