import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { MeResponse } from "@notional/contracts";
import { checkDatabaseHealth } from "@notional/db";
import Fastify, { LogController, type FastifyServerOptions } from "fastify";

import {
  claimAccountFaucet,
  getAccount,
  getFundingHistory,
  initializeAccount,
} from "./account.js";
import { registerAuth, requireAuth } from "./auth-plugin.js";
import { env } from "./env.js";
import { registerErrorHandler } from "./error-handler.js";
import { getExecutionById, getExecutions } from "./executions.js";
import { getPerpFundingHistory } from "./funding.js";
import { getInstrumentBySymbol, getInstruments } from "./instruments.js";
import { createPinoLoggerOptions } from "./logging.js";
import { getLiquidations } from "./liquidations.js";
import { getMarginSettings, putMarginSettings } from "./margin-settings.js";
import { getMarketDataBySymbol, getMarketDataStatus } from "./market-data.js";
import {
  unavailableMarketDataAccess,
  type MarketDataAccess,
} from "./market-data/coordinator.js";
import { getOrderById, getOrders, postOrder, cancelOrder } from "./orders.js";
import { getPositionBySymbol, getPositions } from "./positions.js";
import {
  createAuthRateLimit,
  createUserRateLimit,
  createWsRateLimit,
  type UserLimitKind,
} from "./rate-limit.js";
import type { CommittedPrivateEffect } from "./realtime/effects.js";
import { registerRealtimeRoutes } from "./realtime/plugin.js";
import type { RealtimeRuntime } from "./realtime/runtime.js";
import { isAcceptingTraffic } from "./runtime-status.js";

export const JSON_BODY_LIMIT_BYTES = 32 * 1024;

export type BuildAppOptions = {
  marketData?: MarketDataAccess;
  onOpenOrderCommitted?: (symbol: string) => void;
  onPrivateCommitted?: (effect: CommittedPrivateEffect) => void;
  realtime?: RealtimeRuntime;
  loggerDestination?: NodeJS.WritableStream;
  enableRateLimit?: boolean;
  databaseHealthCheck?: () => Promise<unknown>;
  handleAuthRequest?: (request: Request) => Promise<Response>;
};

export function helmetOptions(enableHsts: boolean) {
  return {
    contentSecurityPolicy: false as const,
    crossOriginEmbedderPolicy: false as const,
    hsts: enableHsts
      ? {
          maxAge: 15552000,
        }
      : false,
  };
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify(fastifyOptions(options.loggerDestination));
  const rateLimitEnabled = options.enableRateLimit ?? process.env.NODE_ENV !== "test";
  const marketData = options.marketData ?? unavailableMarketDataAccess();
  const onPrivateCommitted =
    options.onPrivateCommitted ??
    (options.realtime
      ? (effect: CommittedPrivateEffect) => options.realtime?.onPrivateCommitted(effect)
      : undefined);

  await app.register(helmet, helmetOptions(env.ENABLE_HSTS));

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key"],
  });

  await app.register(rateLimit, {
    global: false,
  });

  registerErrorHandler(app);

  app.addHook("onResponse", (request, reply, done) => {
    request.log.info(
      {
        reqId: request.id,
        method: request.method,
        url: request.routeOptions.url ?? request.url.split("?")[0],
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      "request completed",
    );
    done();
  });

  await registerAuth(
    app,
    rateLimitEnabled ? createAuthRateLimit(app) : undefined,
    options.handleAuthRequest,
  );

  if (options.realtime) {
    await registerRealtimeRoutes(
      app,
      options.realtime,
      rateLimitEnabled ? createWsRateLimit(app) : undefined,
    );
  }

  const databaseHealthCheck = options.databaseHealthCheck ?? checkDatabaseHealth;

  app.get("/health", async () => ({ status: "ok" as const }));
  app.get("/ready", async (_request, reply) => {
    if (!isAcceptingTraffic()) {
      return reply.status(503).send({ status: "not_ready" });
    }

    try {
      await databaseHealthCheck();
    } catch {
      return reply.status(503).send({ status: "not_ready" });
    }

    return { status: "ok" as const };
  });

  const authed = (kind: UserLimitKind) =>
    rateLimitEnabled ? [requireAuth, createUserRateLimit(app, kind)] : requireAuth;

  app.get("/api/account", { preHandler: authed("reads") }, getAccount);
  app.post("/api/account/initialize", { preHandler: authed("initialize") }, (request, reply) =>
    initializeAccount(request, reply, onPrivateCommitted),
  );
  app.post("/api/account/faucet", { preHandler: authed("faucet") }, (request, reply) =>
    claimAccountFaucet(request, reply, onPrivateCommitted),
  );
  app.get("/api/account/funding", { preHandler: authed("reads") }, getFundingHistory);
  app.get("/api/funding", { preHandler: authed("reads") }, getPerpFundingHistory);
  app.get("/api/instruments", { preHandler: authed("reads") }, getInstruments);
  app.get("/api/instruments/:symbol", { preHandler: authed("reads") }, getInstrumentBySymbol);
  app.get("/api/market-data/status", { preHandler: authed("reads") }, (request, reply) =>
    getMarketDataStatus(request, reply, marketData),
  );
  app.get("/api/market-data/:symbol", { preHandler: authed("reads") }, (request, reply) =>
    getMarketDataBySymbol(request, reply, marketData),
  );
  app.get("/api/orders", { preHandler: authed("reads") }, getOrders);
  app.post("/api/orders", { preHandler: authed("orders") }, (request, reply) =>
    postOrder(request, reply, marketData, options.onOpenOrderCommitted, onPrivateCommitted),
  );
  app.get("/api/orders/:id", { preHandler: authed("reads") }, getOrderById);
  app.post("/api/orders/:id/cancel", { preHandler: authed("cancel") }, (request, reply) =>
    cancelOrder(request, reply, onPrivateCommitted),
  );
  app.get("/api/executions", { preHandler: authed("reads") }, getExecutions);
  app.get("/api/executions/:id", { preHandler: authed("reads") }, getExecutionById);
  app.get("/api/liquidations", { preHandler: authed("reads") }, getLiquidations);
  app.get("/api/positions", { preHandler: authed("reads") }, getPositions);
  app.get("/api/positions/:symbol", { preHandler: authed("reads") }, getPositionBySymbol);
  app.get("/api/margin-settings/:symbol", { preHandler: authed("reads") }, getMarginSettings);
  app.put("/api/margin-settings/:symbol", { preHandler: authed("margin") }, (request, reply) =>
    putMarginSettings(request, reply, onPrivateCommitted),
  );

  app.get(
    "/api/me",
    { preHandler: authed("reads") },
    async (request, reply): Promise<MeResponse | { error: string }> => {
      const session = request.auth;

      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const { user } = session;

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          createdAt: toIsoString(user.createdAt),
        },
      };
    },
  );

  return app;
}

function fastifyOptions(destination?: NodeJS.WritableStream): FastifyServerOptions {
  const testLogger = process.env.NODE_ENV === "test" && !destination;
  return {
    trustProxy: env.TRUST_PROXY as FastifyServerOptions["trustProxy"],
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    logController: new LogController({ disableRequestLogging: true }),
    logger: testLogger ? false : createPinoLoggerOptions(env.LOG_LEVEL, destination),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
