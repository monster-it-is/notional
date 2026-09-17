import type { FastifyError, FastifyInstance } from "fastify";

import { unknownErrorLogFields } from "./logging.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function publicClientError(error: FastifyError): { status: number; body: { error: string } } | null {
  const statusCode = error.statusCode ?? 0;
  const code = error.code ?? "";

  if (code === "FST_ERR_CTP_BODY_TOO_LARGE" || statusCode === 413) {
    return { status: 413, body: { error: "PAYLOAD_TOO_LARGE" } };
  }

  if (code === "FST_ERR_VALIDATION" || error.validation !== undefined) {
    return { status: 400, body: { error: "INVALID_REQUEST" } };
  }

  if (statusCode === 429 || code === "FST_ERR_RATE_LIMIT") {
    return { status: 429, body: { error: "RATE_LIMITED" } };
  }

  return null;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const mapped = publicClientError(error);
    if (mapped) {
      return reply.status(mapped.status).send(mapped.body);
    }

    request.log.error(unknownErrorLogFields(error), "unhandled error");

    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: "INVALID_REQUEST" });
    }

    return reply.status(500).send({ error: "INTERNAL_ERROR" });
  });
}

export function errorLooksSafe(body: unknown): boolean {
  if (!isRecord(body)) {
    return false;
  }

  const serialized = JSON.stringify(body).toLowerCase();
  return (
    !serialized.includes("stack") &&
    !serialized.includes("select ") &&
    !serialized.includes("postgresql://") &&
    !serialized.includes("enoent")
  );
}
