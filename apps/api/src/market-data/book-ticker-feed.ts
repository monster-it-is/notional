import { parseBookTick, parseJsonPayload } from "./parse-events.js";
import {
  silentLogger,
  systemScheduler,
  type BookTick,
  type Logger,
  type Scheduler,
  type TimeoutHandle,
} from "./types.js";
import { createReconnectingWsClient, type ReconnectingWsClient } from "./ws-client.js";
import type { WsTransport } from "./ws-transport.js";

export const MAX_STREAMS_PER_CONNECTION = 200;
export const SUBSCRIBE_CHUNK_SIZE = 50;
export const SUBSCRIBE_CHUNK_DELAY_MS = 250;

export type BookTickerFeed = {
  start(): void;
  stop(): void;
  setSymbols(symbols: string[]): void;
  isConnected(): boolean;
};

type BookConnection = {
  client: ReconnectingWsClient;
  symbols: string[];
  subscribeGeneration: number;
};

export function createBookTickerFeed(options: {
  publicWsBaseUrl: string;
  transport: WsTransport;
  onBook: (tick: BookTick) => void;
  reconnectMaxMs: number;
  scheduler?: Scheduler;
  random?: () => number;
  logger?: Logger;
  connectionMaxMs?: number;
  maxStreamsPerConnection?: number;
  subscribeChunkSize?: number;
  subscribeChunkDelayMs?: number;
}): BookTickerFeed {
  const scheduler = options.scheduler ?? systemScheduler;
  const logger = options.logger ?? silentLogger;
  const maxStreams = options.maxStreamsPerConnection ?? MAX_STREAMS_PER_CONNECTION;
  const chunkSize = options.subscribeChunkSize ?? SUBSCRIBE_CHUNK_SIZE;
  const chunkDelayMs = options.subscribeChunkDelayMs ?? SUBSCRIBE_CHUNK_DELAY_MS;
  const url = `${options.publicWsBaseUrl.replace(/\/$/, "")}/ws`;

  const connections: BookConnection[] = [];
  let desired = new Set<string>();
  let started = false;
  let requestId = 1;
  const pendingTimers = new Set<TimeoutHandle>();

  function sendSubscribe(connection: BookConnection, symbols: string[]) {
    if (symbols.length === 0 || !connection.client.isConnected()) {
      return;
    }

    const gen = ++connection.subscribeGeneration;
    const chunks = chunk(symbols, chunkSize);

    const sendChunk = (index: number) => {
      if (gen !== connection.subscribeGeneration || index >= chunks.length) {
        return;
      }

      const group = chunks[index];

      if (!group) {
        return;
      }

      connection.client.send(
        JSON.stringify({
          method: "SUBSCRIBE",
          params: group.map(bookTickerStream),
          id: requestId,
        }),
      );
      requestId += 1;

      if (index < chunks.length - 1) {
        const handle = scheduler.setTimeout(() => {
          pendingTimers.delete(handle);
          sendChunk(index + 1);
        }, chunkDelayMs);
        pendingTimers.add(handle);
      }
    };

    sendChunk(0);
  }

  function createConnection(symbols: string[]): BookConnection {
    const connection: BookConnection = {
      symbols: [...symbols],
      subscribeGeneration: 0,
      client: createReconnectingWsClient({
        url,
        transport: options.transport,
        reconnectMaxMs: options.reconnectMaxMs,
        scheduler,
        random: options.random,
        connectionMaxMs: options.connectionMaxMs,
        logger,
        onOpen() {
          sendSubscribe(connection, connection.symbols);
        },
        onMessage(data) {
          const payload = parseJsonPayload(data);

          if (payload === null) {
            return;
          }

          const tick = parseBookTick(payload);

          if (tick) {
            options.onBook(tick);
          }
        },
      }),
    };

    return connection;
  }

  function reconcile() {
    const buckets = chunk([...desired].sort(), maxStreams);

    while (connections.length > buckets.length) {
      connections.pop()?.client.stop();
    }

    buckets.forEach((symbols, index) => {
      const existing = connections[index];

      if (!existing) {
        const created = createConnection(symbols);
        connections.push(created);

        if (started) {
          created.client.start();
        }

        return;
      }

      const previousSymbols = existing.symbols;
      existing.symbols = [...symbols];

      if (
        !started ||
        !existing.client.isConnected() ||
        sameSymbolSet(previousSymbols, existing.symbols)
      ) {
        return;
      }

      existing.subscribeGeneration += 1;
      const previousSet = new Set(previousSymbols);
      const added = symbols.filter((symbol) => !previousSet.has(symbol));
      const removed = previousSymbols.filter((symbol) => !symbols.includes(symbol));

      if (removed.length > 0) {
        existing.client.send(
          JSON.stringify({
            method: "UNSUBSCRIBE",
            params: removed.map(bookTickerStream),
            id: requestId,
          }),
        );
        requestId += 1;
      }

      sendSubscribe(existing, added);
    });
  }

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      reconcile();

      for (const connection of connections) {
        connection.client.start();
      }
    },
    stop() {
      started = false;
      desired = new Set();

      for (const timer of pendingTimers) {
        scheduler.clearTimeout(timer);
      }

      pendingTimers.clear();

      for (const connection of connections) {
        connection.client.stop();
      }

      connections.length = 0;
    },
    setSymbols(symbols) {
      desired = new Set(symbols);
      reconcile();
    },
    isConnected() {
      if (desired.size === 0) {
        return true;
      }

      return connections.length > 0 && connections.every((connection) => connection.client.isConnected());
    },
  };
}

function sameSymbolSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((symbol) => rightSet.has(symbol));
}

export function bookTickerStream(symbol: string): string {
  return `${symbol.toLowerCase()}@bookTicker`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunk size must be positive");
  }

  const groups: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }

  return groups;
}
