import { buildApp } from "./app.js";
import { env } from "./env.js";
import { createMarketDataRuntime } from "./market-data/coordinator.js";

const start = async () => {
  const marketData = createMarketDataRuntime({ env });
  const app = await buildApp({ marketData });

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
