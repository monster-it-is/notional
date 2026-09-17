import websocket from "@fastify/websocket";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { WebSocket } from "ws";

import { env } from "../env.js";
import { loadInitializedAccount } from "../account.js";
import { auth } from "../auth.js";
import { isExactWebOrigin, requestOrigin } from "./origin.js";
import type { RealtimeRuntime, RealtimeSocket } from "./runtime.js";

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  realtime: RealtimeRuntime,
  wsRateLimit?: preHandlerAsyncHookHandler,
): Promise<void> {
  await app.register(websocket, {
    options: {
      maxPayload: 4096,
    },
  });

  app.get(
    "/ws/market",
    {
      websocket: true,
      onRequest: wsRateLimit,
      async preValidation(request, reply) {
        if (!isExactWebOrigin(requestOrigin(request), env.WEB_ORIGIN)) {
          return reply.status(403).send({ error: "ORIGIN_REJECTED" });
        }
      },
    },
    (socket) => {
      realtime.attachMarketSocket(adaptSocket(socket));
    },
  );

  app.get(
    "/ws/account",
    {
      websocket: true,
      onRequest: wsRateLimit,
      async preValidation(request, reply) {
        if (!isExactWebOrigin(requestOrigin(request), env.WEB_ORIGIN)) {
          return reply.status(403).send({ error: "ORIGIN_REJECTED" });
        }

        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });

        if (!session) {
          return reply.status(401).send({ error: "Unauthorized" });
        }

        const initialized = await loadInitializedAccount(session.user.id);

        if (!initialized) {
          return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
        }

        bindAccountUpgrade(request, session.user.id, initialized.account.id);
      },
    },
    (socket, request) => {
      const binding = readAccountUpgrade(request);

      if (!binding) {
        socket.close(4401, "AUTH_EXPIRED");
        return;
      }

      realtime.attachAccountSocket(adaptSocket(socket), {
        userId: binding.userId,
        paperAccountId: binding.paperAccountId,
        handshakeHeaders: request.headers,
      });
    },
  );
}

type AccountUpgradeBinding = {
  userId: string;
  paperAccountId: string;
};

const accountUpgrades = new WeakMap<FastifyRequest, AccountUpgradeBinding>();

function bindAccountUpgrade(request: FastifyRequest, userId: string, paperAccountId: string): void {
  accountUpgrades.set(request, { userId, paperAccountId });
}

function readAccountUpgrade(request: FastifyRequest): AccountUpgradeBinding | undefined {
  return accountUpgrades.get(request);
}

function adaptSocket(socket: WebSocket): RealtimeSocket {
  return {
    send(data) {
      socket.send(data);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    getBufferedAmount() {
      return socket.bufferedAmount;
    },
    onMessage(handler) {
      socket.on("message", handler);
    },
    onClose(handler) {
      socket.on("close", handler);
    },
  };
}
