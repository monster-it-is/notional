import type { FastifyInstance } from "fastify";

import { unknownErrorLogFields } from "./logging.js";
import { markRuntimeReady } from "./runtime-status.js";

export type RuntimeBootstrapResources = {
  app: FastifyInstance;
  port: number;
  host?: string;
  marketData: {
    start(): Promise<void>;
  };
  liquidationScanner: {
    start(): void;
  };
  fundingScanner: {
    start(): void;
  };
  shutdown: () => Promise<void>;
  exit: (code: number) => void;
};

export async function listenThenBootstrapRuntime(
  resources: RuntimeBootstrapResources,
): Promise<void> {
  const host = resources.host ?? "0.0.0.0";

  try {
    await resources.app.listen({
      port: resources.port,
      host,
    });
    resources.app.log.info({ port: resources.port }, "api listening");
  } catch (error) {
    resources.app.log.error(unknownErrorLogFields(error), "api listen failed");
    resources.exit(1);
    return;
  }

  try {
    resources.app.log.info("runtime bootstrap starting");
    await resources.marketData.start();
    resources.liquidationScanner.start();
    resources.fundingScanner.start();
    markRuntimeReady();
    resources.app.log.info("runtime ready");
  } catch (error) {
    resources.app.log.error(unknownErrorLogFields(error), "runtime bootstrap failed");
    await resources.shutdown();
    resources.exit(1);
  }
}
