import { closePool } from "@notional/db";
import type { FastifyInstance } from "fastify";

import { createLoggerAdapter, createLoggerProxy } from "./logging.js";
import type { Logger } from "./market-data/types.js";
import { beginShutdownStatus, getRuntimeStatus } from "./runtime-status.js";

export type ShutdownResources = {
  app: FastifyInstance;
  matcher: {
    stop(): void;
    waitForIdle(): Promise<void>;
  };
  fundingScanner: {
    stop(): void;
    waitForIdle(): Promise<void>;
  };
  liquidationScanner: {
    stop(): void;
    waitForIdle(): Promise<void>;
  };
  realtime: {
    shutdown(): Promise<void>;
  };
  marketData: {
    stopScheduling(): void;
    waitForSyncIdle(): Promise<void>;
    stop(): Promise<void>;
  };
  disableTickScheduling: () => void;
  timeoutMs: number;
  logger: Logger;
  closePool?: () => Promise<void>;
  exit?: (code: number) => void;
};

let inFlight: Promise<void> | undefined;

export function shutdownOnce(resources: ShutdownResources): Promise<void> {
  if (inFlight) {
    resources.logger.info("shutdown already in progress");
    return inFlight;
  }

  inFlight = runShutdown(resources);
  return inFlight;
}

export function resetShutdownForTests(): void {
  inFlight = undefined;
}

async function runShutdown(resources: ShutdownResources): Promise<void> {
  const timeout = unrefTimeout(resources.timeoutMs);
  try {
    await Promise.race([
      performShutdown(resources),
      timeout.promise.then(() => {
        throw new Error("shutdown timed out");
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === "shutdown timed out") {
      resources.logger.error("shutdown timed out");
      resources.exit?.(1);
      return;
    }

    resources.logger.error("shutdown failed", {
      detail: error instanceof Error ? error.message : "shutdown failed",
    });
    resources.exit?.(1);
  } finally {
    timeout.clear();
  }
}

async function performShutdown(resources: ShutdownResources): Promise<void> {
  const logger = resources.logger;
  beginShutdownStatus();
  logger.info("shutdown started", { ...getRuntimeStatus() });

  const closing = resources.app.close();

  resources.disableTickScheduling();
  resources.fundingScanner.stop();
  resources.liquidationScanner.stop();
  resources.marketData.stopScheduling();
  logger.info("background scheduling stopped");

  await resources.realtime.shutdown();
  logger.info("realtime sockets closed");

  await Promise.all([
    resources.fundingScanner.waitForIdle(),
    resources.liquidationScanner.waitForIdle(),
    resources.marketData.waitForSyncIdle(),
  ]);
  logger.info("funding, liquidation, and catalog workers idle");

  await closing;
  logger.info("http drained");

  resources.matcher.stop();
  await resources.matcher.waitForIdle();
  logger.info("matcher idle");

  await resources.marketData.stop();
  logger.info("market-data stopped");

  await (resources.closePool ?? closePool)();
  logger.info("database pool closed");
}

function unrefTimeout(ms: number): { promise: Promise<void>; clear: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
    handle.unref?.();
  });
  return {
    promise,
    clear() {
      if (handle) {
        clearTimeout(handle);
      }
    },
  };
}

export function bindFastifyLogger(
  proxy: ReturnType<typeof createLoggerProxy>,
  app: FastifyInstance,
): void {
  proxy.bind(createLoggerAdapter(app.log));
}
