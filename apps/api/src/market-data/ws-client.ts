import {
  silentLogger,
  systemScheduler,
  type Logger,
  type Scheduler,
  type TimeoutHandle,
} from "./types.js";
import {
  computeReconnectDelay,
  WS_BACKOFF_BASE_MS,
  WS_CONNECTION_MAX_MS,
  type WsConnection,
  type WsTransport,
} from "./ws-transport.js";

export type ReconnectingWsClient = {
  start(): void;
  stop(): void;
  send(data: string): void;
  isConnected(): boolean;
};

export function createReconnectingWsClient(options: {
  url: string;
  transport: WsTransport;
  onMessage: (data: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  scheduler?: Scheduler;
  random?: () => number;
  reconnectMaxMs: number;
  backoffBaseMs?: number;
  connectionMaxMs?: number;
  logger?: Logger;
}): ReconnectingWsClient {
  const scheduler = options.scheduler ?? systemScheduler;
  const random = options.random ?? Math.random;
  const logger = options.logger ?? silentLogger;
  const backoffBaseMs = options.backoffBaseMs ?? WS_BACKOFF_BASE_MS;
  const connectionMaxMs = options.connectionMaxMs ?? WS_CONNECTION_MAX_MS;

  let generation = 0;
  let stopped = false;
  let attempt = 0;
  let connected = false;
  let connection: WsConnection | null = null;
  let reconnectTimer: TimeoutHandle | undefined;
  let rotateTimer: TimeoutHandle | undefined;
  let started = false;

  function clearTimers() {
    if (reconnectTimer) {
      scheduler.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }

    if (rotateTimer) {
      scheduler.clearTimeout(rotateTimer);
      rotateTimer = undefined;
    }
  }

  function connect() {
    if (stopped) {
      return;
    }

    generation += 1;
    const gen = generation;
    clearTimers();
    connection?.close();
    connected = false;
    connection = options.transport.connect(options.url);

    connection.onOpen(() => {
      if (gen !== generation || stopped) {
        return;
      }

      connected = true;
      attempt = 0;
      options.onOpen?.();
      rotateTimer = scheduler.setTimeout(() => {
        if (gen !== generation || stopped) {
          return;
        }

        logger.info("rotating binance websocket before 24h lifetime");
        connection?.close();
      }, connectionMaxMs);
    });

    connection.onMessage((data) => {
      if (gen !== generation || stopped) {
        return;
      }

      options.onMessage(data);
    });

    connection.onError((error) => {
      if (gen !== generation || stopped) {
        return;
      }

      logger.warn("binance websocket error", { detail: error.message });
    });

    connection.onClose(() => {
      if (gen !== generation) {
        return;
      }

      connected = false;
      connection = null;
      if (rotateTimer) {
        scheduler.clearTimeout(rotateTimer);
        rotateTimer = undefined;
      }
      options.onClose?.();

      if (stopped) {
        return;
      }

      const delay = computeReconnectDelay({
        attempt,
        random,
        baseMs: backoffBaseMs,
        maxMs: options.reconnectMaxMs,
      });
      attempt += 1;
      logger.warn("binance websocket closed; reconnecting", { delayMs: delay, attempt });
      reconnectTimer = scheduler.setTimeout(connect, delay);
    });
  }

  return {
    start() {
      if (started || stopped) {
        return;
      }

      started = true;
      connect();
    },
    stop() {
      stopped = true;
      generation += 1;
      clearTimers();
      connection?.close();
      connection = null;
      connected = false;
    },
    send(data) {
      connection?.send(data);
    },
    isConnected() {
      return connected;
    },
  };
}
