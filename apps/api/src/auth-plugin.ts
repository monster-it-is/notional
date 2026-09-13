import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { auth } from "./auth.js";

type AuthSession = typeof auth.$Infer.Session;

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthSession | null;
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  request.auth = session;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.decorateRequest("auth", null);

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        const url = new URL(request.url, envBaseUrl(request));
        const headers = fromNodeHeaders(request.headers);
        const body =
          request.body !== undefined &&
          request.method !== "GET" &&
          request.method !== "HEAD"
            ? JSON.stringify(request.body)
            : undefined;

        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers,
            body,
          }),
        );

        reply.status(response.status);

        const setCookies =
          typeof response.headers.getSetCookie === "function"
            ? response.headers.getSetCookie()
            : [];

        response.headers.forEach((value, key) => {
          const headerName = key.toLowerCase();
          if (headerName === "set-cookie" || headerName === "content-length") {
            return;
          }
          reply.header(key, value);
        });

        if (setCookies.length > 0) {
          reply.header("set-cookie", setCookies);
        }

        const text = await response.text();
        const contentType = response.headers.get("content-type") ?? "";

        if (text.length === 0) {
          return reply.send(null);
        }

        if (contentType.includes("application/json")) {
          return reply.send(JSON.parse(text));
        }

        return reply.send(text);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: "Internal authentication error" });
      }
    },
  });
}

function envBaseUrl(request: FastifyRequest): string {
  const host = request.headers.host ?? "localhost";
  return `${request.protocol}://${host}`;
}
