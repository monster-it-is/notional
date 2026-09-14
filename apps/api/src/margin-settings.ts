import type {
  AccountNotInitializedError,
  InstrumentNotFoundError,
  InvalidMarginSettingsError,
  MarginSettingsResponse,
  PositionNotFlatError,
} from "@notional/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  MarginSettingsError,
  parseUpdateMarginSettingsRequest,
  readMarginSettings,
  updateMarginSettings,
} from "./services/margin-settings.js";

const CANONICAL_SYMBOL = /^[A-Z0-9]+$/;

export async function getMarginSettings(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<
  MarginSettingsResponse | AccountNotInitializedError | InstrumentNotFoundError | { error: string }
> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const symbol = requestSymbol(request);

  if (!symbol) {
    return reply.status(404).send({ error: "INSTRUMENT_NOT_FOUND" });
  }

  try {
    return await readMarginSettings(session.user.id, symbol);
  } catch (error) {
    return sendMarginSettingsError(reply, error);
  }
}

export async function putMarginSettings(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<
  | MarginSettingsResponse
  | AccountNotInitializedError
  | InstrumentNotFoundError
  | InvalidMarginSettingsError
  | PositionNotFlatError
  | { error: string }
> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const symbol = requestSymbol(request);

  if (!symbol) {
    return reply.status(404).send({ error: "INSTRUMENT_NOT_FOUND" });
  }

  try {
    const input = parseUpdateMarginSettingsRequest(request.body);
    return await updateMarginSettings(session.user.id, symbol, input);
  } catch (error) {
    return sendMarginSettingsError(reply, error);
  }
}

function sendMarginSettingsError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof MarginSettingsError)) {
    throw error;
  }

  if (error.code === "INVALID_MARGIN_SETTINGS") {
    return reply.status(400).send({
      error: "INVALID_MARGIN_SETTINGS",
      reason: error.reason,
    });
  }

  if (error.code === "INSTRUMENT_NOT_FOUND") {
    return reply.status(404).send({ error: error.code });
  }

  return reply.status(409).send({ error: error.code });
}

function requestSymbol(request: FastifyRequest): string | null {
  const params = request.params;

  if (params === undefined || params === null || typeof params !== "object") {
    return null;
  }

  if (!("symbol" in params) || typeof params.symbol !== "string" || params.symbol === "") {
    return null;
  }

  if (!CANONICAL_SYMBOL.test(params.symbol)) {
    return null;
  }

  return params.symbol;
}
