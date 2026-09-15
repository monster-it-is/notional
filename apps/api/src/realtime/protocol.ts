import type { RealtimeClientMessage } from "@notional/contracts";
import { z } from "zod";

const CANONICAL_SYMBOL = /^[A-Z0-9]+$/;

const clientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("market.subscribe"),
      symbol: z.string().regex(CANONICAL_SYMBOL),
    })
    .strict(),
  z
    .object({
      type: z.literal("market.unsubscribe"),
      symbol: z.string().regex(CANONICAL_SYMBOL),
    })
    .strict(),
  z
    .object({
      type: z.literal("ping"),
      ts: z.number().finite().optional(),
    })
    .strict(),
]);

export type ParsedClientMessage =
  | { ok: true; message: RealtimeClientMessage }
  | { ok: false; code: "INVALID_JSON" | "INVALID_MESSAGE"; message: string };

export function parseClientMessage(raw: string): ParsedClientMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "malformed JSON" };
  }

  const result = clientMessageSchema.safeParse(parsed);

  if (!result.success) {
    return { ok: false, code: "INVALID_MESSAGE", message: "invalid client message" };
  }

  return { ok: true, message: result.data };
}

export function inboundByteLength(data: unknown): number {
  if (typeof data === "string") {
    return Buffer.byteLength(data);
  }

  if (Buffer.isBuffer(data)) {
    return data.byteLength;
  }

  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }

  if (ArrayBuffer.isView(data)) {
    return data.byteLength;
  }

  return Buffer.byteLength(String(data));
}

export function inboundText(data: unknown): string | null {
  if (typeof data === "string") {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }

  return null;
}
