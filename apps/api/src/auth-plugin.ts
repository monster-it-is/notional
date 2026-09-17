import { fromNodeHeaders } from "better-auth/node";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";

import { auth } from "./auth.js";
import { env } from "./env.js";
import { unknownErrorLogFields } from "./logging.js";

type AuthSession = typeof auth.$Infer.Session;

const AUTH_AUTHORITY_HEADERS = new Set([
  "host",
  "x-forwarded-host",
  "x-forwarded-proto",
  "forwarded",
]);

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

export function authHandlerUrl(requestTarget: string, canonicalOrigin: string): URL {
  const { pathname, search } = pathAndSearch(requestTarget);
  const url = new URL(canonicalOrigin);
  url.pathname = pathname;
  url.search = search;
  url.hash = "";
  return url;
}

export function authHandlerHeaders(
  headers: FastifyRequest["headers"],
): Headers {
  const sanitized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (AUTH_AUTHORITY_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    sanitized[key] = value;
  }
  return fromNodeHeaders(sanitized);
}

export function createAuthHandlerRequest(
  request: {
    url: string;
    method: string;
    headers: FastifyRequest["headers"];
    body?: unknown;
  },
  canonicalOrigin: string,
): Request {
  const url = authHandlerUrl(request.url, canonicalOrigin);
  const headers = authHandlerHeaders(request.headers);
  const body =
    request.body !== undefined && request.method !== "GET" && request.method !== "HEAD"
      ? JSON.stringify(request.body)
      : undefined;

  return new Request(url, {
    method: request.method,
    headers,
    body,
  });
}

function pathAndSearch(requestTarget: string): { pathname: string; search: string } {
  const extracted = new URL(requestTarget, "https://auth-request-target.invalid");
  return { pathname: extracted.pathname, search: extracted.search };
}

export async function registerAuth(
  app: FastifyInstance,
  authRateLimit?: preHandlerAsyncHookHandler,
  handleAuthRequest: (request: Request) => Promise<Response> = (request) => auth.handler(request),
): Promise<void> {
  app.decorateRequest("auth", null);

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    preHandler: authRateLimit,
    async handler(request, reply) {
      try {
        const response = await handleAuthRequest(
          createAuthHandlerRequest(request, env.BETTER_AUTH_URL),
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
        request.log.error(unknownErrorLogFields(error), "unhandled authentication error");
        return reply.status(500).send({ error: "INTERNAL_ERROR" });
      }
    },
  });
}
