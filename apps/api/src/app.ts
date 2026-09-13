import cors from "@fastify/cors";
import type { MeResponse } from "@notional/contracts";
import { checkDatabaseHealth } from "@notional/db";
import Fastify from "fastify";

import { registerAuth, requireAuth } from "./auth-plugin.js";
import { env } from "./env.js";

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });

  await registerAuth(app);

  app.get("/health", async () => {
    await checkDatabaseHealth();
    return {
      status: "ok",
    };
  });

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
