import type { RealtimeServerMessage } from "@notional/contracts";
import { REALTIME_PROTOCOL_VERSION } from "@notional/contracts";

export function parseServerMessage(raw: string): RealtimeServerMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    return null;
  }

  const message = parsed as { type: unknown };

  if (typeof message.type !== "string") {
    return null;
  }

  return parsed as RealtimeServerMessage;
}

export function isValidHello(
  message: RealtimeServerMessage,
  channel: "account" | "market",
): boolean {
  return (
    message.type === "hello" &&
    message.protocolVersion === REALTIME_PROTOCOL_VERSION &&
    message.channel === channel
  );
}

export function inboundText(data: unknown): string | null {
  if (typeof data === "string") {
    return data;
  }

  return null;
}
