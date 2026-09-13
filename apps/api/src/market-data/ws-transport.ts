export type WsConnection = {
  send(data: string): void;
  close(): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
};

export type WsTransport = {
  connect(url: string): WsConnection;
};

export function createNodeWsTransport(): WsTransport {
  return {
    connect(url) {
      const socket = new WebSocket(url);
      return {
        send(data) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
          }
        },
        close() {
          if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
        },
        onOpen(handler) {
          socket.addEventListener("open", () => handler());
        },
        onMessage(handler) {
          socket.addEventListener("message", (event) => {
            handler(typeof event.data === "string" ? event.data : String(event.data));
          });
        },
        onClose(handler) {
          socket.addEventListener("close", () => handler());
        },
        onError(handler) {
          socket.addEventListener("error", () => handler(new Error("websocket error")));
        },
      };
    },
  };
}

export function computeReconnectDelay(options: {
  attempt: number;
  random: () => number;
  baseMs: number;
  maxMs: number;
}): number {
  const exponential = Math.min(options.maxMs, options.baseMs * 2 ** options.attempt);
  const jitter = 0.5 + options.random() * 0.5;
  return Math.floor(exponential * jitter);
}

export const WS_BACKOFF_BASE_MS = 1_000;
export const WS_CONNECTION_MAX_MS = 23 * 60 * 60 * 1000;
