import cors from "@fastify/cors";
import type { MeResponse } from "@notional/contracts";
import { checkDatabaseHealth } from "@notional/db";
import Fastify from "fastify";

import {
  claimAccountFaucet,
  getAccount,
  getFundingHistory,
  initializeAccount,
} from "./account.js";
import { registerAuth, requireAuth } from "./auth-plugin.js";
import { env } from "./env.js";
import { getExecutionById, getExecutions } from "./executions.js";
import { getPerpFundingHistory } from "./funding.js";
import { getInstrumentBySymbol, getInstruments } from "./instruments.js";
import { getLiquidations } from "./liquidations.js";
import { getMarginSettings, putMarginSettings } from "./margin-settings.js";
import { getMarketDataBySymbol, getMarketDataStatus } from "./market-data.js";
import {
  unavailableMarketDataAccess,
  type MarketDataAccess,
} from "./market-data/coordinator.js";
import { getOrderById, getOrders, postOrder, cancelOrder } from "./orders.js";
import { getPositionBySymbol, getPositions } from "./positions.js";

export type BuildAppOptions = {
  marketData?: MarketDataAccess;
  onOpenOrderCommitted?: (symbol: string) => void;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });
  const marketData = options.marketData ?? unavailableMarketDataAccess();

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key"],
  });

  await registerAuth(app);

  app.get("/health", async () => {
    await checkDatabaseHealth();
    return {
      status: "ok",
    };
  });

  app.get("/api/account", { preHandler: requireAuth }, getAccount);
  app.post("/api/account/initialize", { preHandler: requireAuth }, initializeAccount);
  app.post("/api/account/faucet", { preHandler: requireAuth }, claimAccountFaucet);
  app.get("/api/account/funding", { preHandler: requireAuth }, getFundingHistory);
  app.get("/api/funding", { preHandler: requireAuth }, getPerpFundingHistory);
  app.get("/api/instruments", { preHandler: requireAuth }, getInstruments);
  app.get("/api/instruments/:symbol", { preHandler: requireAuth }, getInstrumentBySymbol);
  app.get("/api/market-data/status", { preHandler: requireAuth }, (request, reply) =>
    getMarketDataStatus(request, reply, marketData),
  );
  app.get("/api/market-data/:symbol", { preHandler: requireAuth }, (request, reply) =>
    getMarketDataBySymbol(request, reply, marketData),
  );
  app.get("/api/orders", { preHandler: requireAuth }, getOrders);
  app.post("/api/orders", { preHandler: requireAuth }, (request, reply) =>
    postOrder(request, reply, marketData, options.onOpenOrderCommitted),
  );
  app.get("/api/orders/:id", { preHandler: requireAuth }, getOrderById);
  app.post("/api/orders/:id/cancel", { preHandler: requireAuth }, cancelOrder);
  app.get("/api/executions", { preHandler: requireAuth }, getExecutions);
  app.get("/api/executions/:id", { preHandler: requireAuth }, getExecutionById);
  app.get("/api/liquidations", { preHandler: requireAuth }, getLiquidations);
  app.get("/api/positions", { preHandler: requireAuth }, getPositions);
  app.get("/api/positions/:symbol", { preHandler: requireAuth }, getPositionBySymbol);
  app.get("/api/margin-settings/:symbol", { preHandler: requireAuth }, getMarginSettings);
  app.put("/api/margin-settings/:symbol", { preHandler: requireAuth }, putMarginSettings);

  app.get("/api/me", { preHandler: requireAuth }, async (request, reply): Promise<MeResponse | { error: string }> => {
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
  });

  return app;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
