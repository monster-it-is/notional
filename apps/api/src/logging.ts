import type { FastifyBaseLogger } from "fastify";

import type { Logger } from "./market-data/types.js";

export const PINO_REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "password",
  "token",
  "secret",
  "*.password",
  "*.secret",
  "*.token",
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "BETTER_AUTH_SECRET",
] as const;

const SAFE_ERROR_IDENTIFIER = /^[A-Za-z0-9._-]{1,64}$/;

export type UnknownErrorDiagnostic = {
  name: string;
  code?: string;
};

export function createPinoLoggerOptions(
  level: string,
  destination?: NodeJS.WritableStream,
) {
  return {
    level,
    redact: {
      paths: [...PINO_REDACT_PATHS],
      censor: "[Redacted]",
    },
    ...(destination ? { stream: destination } : {}),
  };
}

export function unknownErrorDiagnostic(error: unknown): UnknownErrorDiagnostic {
  const name = safeErrorName(error);
  const code = safeErrorCode(error);
  return code === undefined ? { name } : { name, code };
}

export function unknownErrorLogFields(error: unknown): {
  err: UnknownErrorDiagnostic;
} {
  return { err: unknownErrorDiagnostic(error) };
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) {
    return "UnknownError";
  }

  return safeErrorIdentifier(error.name) ?? "Error";
}

function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return safeErrorIdentifier(error.code);
}

function safeErrorIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string" || !SAFE_ERROR_IDENTIFIER.test(value)) {
    return undefined;
  }

  return value;
}

export function createLoggerAdapter(log: FastifyBaseLogger): Logger {
  return {
    info(message, extra) {
      log.info(extra ?? {}, message);
    },
    warn(message, extra) {
      log.warn(extra ?? {}, message);
    },
    error(message, extra) {
      log.error(extra ?? {}, message);
    },
  };
}

export function createLoggerProxy(): Logger & { bind(next: Logger): void } {
  let sink: Logger = {
    info() {},
    warn() {},
    error() {},
  };

  return {
    bind(next) {
      sink = next;
    },
    info(message, extra) {
      sink.info(message, extra);
    },
    warn(message, extra) {
      sink.warn(message, extra);
    },
    error(message, extra) {
      sink.error(message, extra);
    },
  };
}
