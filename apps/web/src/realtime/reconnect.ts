export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open_awaiting_hello"
  | "ready"
  | "reconnecting"
  | "protocol_error"
  | "auth_expired"
  | "closed";

export const PING_INTERVAL_MS = 15_000;
export const BASE_RECONNECT_MS = 1_000;
export const MAX_RECONNECT_MS = 30_000;
export const SLOW_RECONNECT_FLOOR_MS = 4_000;

export function reconnectDelay(
  attempt: number,
  options: { slower?: boolean; random?: () => number } = {},
): number {
  const random = options.random ?? Math.random;
  const exp = Math.min(BASE_RECONNECT_MS * 2 ** Math.max(attempt, 0), MAX_RECONNECT_MS);
  const floor = options.slower ? Math.max(exp, SLOW_RECONNECT_FLOOR_MS) : exp;
  const jitter = Math.floor(random() * 251);
  return Math.min(floor + jitter, MAX_RECONNECT_MS + 250);
}

export type WebSocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: { data?: unknown; code?: number; reason?: string }) => void): void;
  removeEventListener(type: string, listener: (...args: never[]) => void): void;
};

export function defaultCreateWebSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}
