import type { CandleInterval } from "@notional/contracts";

import {
  MAX_STREAMS_PER_CONNECTION,
  SUBSCRIBE_CHUNK_DELAY_MS,
  SUBSCRIBE_CHUNK_SIZE,
  chunk,
} from "./book-ticker-feed.js";
import { parseJsonPayload } from "./parse-events.js";
import { parseLiveKline, type LiveKline } from "./parse-live-kline.js";
import {
  silentLogger,
  systemScheduler,
  type Logger,
  type Scheduler,
  type TimeoutHandle,
} from "./types.js";
import { createReconnectingWsClient, type ReconnectingWsClient } from "./ws-client.js";
import type { WsTransport } from "./ws-transport.js";

export type KlineFeed = {
  start(): void;
  stop(): void;
  acquire(symbol: string, interval: CandleInterval): void;
  release(symbol: string, interval: CandleInterval): void;
  refCount(symbol: string, interval: CandleInterval): number;
  isConnected(): boolean;
};

type KlineConnection = {
  client: ReconnectingWsClient;
  keys: string[];
  subscribeGeneration: number;
};

export function createKlineFeed(options: {
  publicWsBaseUrl: string;
  transport: WsTransport;
  onKline: (kline: LiveKline) => void;
  reconnectMaxMs: number;
  scheduler?: Scheduler;
  random?: () => number;
  logger?: Logger;
  connectionMaxMs?: number;
  maxStreamsPerConnection?: number;
  subscribeChunkSize?: number;
  subscribeChunkDelayMs?: number;
}): KlineFeed {
  const scheduler = options.scheduler ?? systemScheduler;
  const logger = options.logger ?? silentLogger;
  const maxStreams = options.maxStreamsPerConnection ?? MAX_STREAMS_PER_CONNECTION;
  const chunkSize = options.subscribeChunkSize ?? SUBSCRIBE_CHUNK_SIZE;
  const chunkDelayMs = options.subscribeChunkDelayMs ?? SUBSCRIBE_CHUNK_DELAY_MS;
  const url = `${options.publicWsBaseUrl.replace(/\/$/, "")}/ws`;

  const connections: KlineConnection[] = [];
  const refs = new Map<string, number>();
  let desired = new Set<string>();
  let started = false;
  let requestId = 1;
  const pendingTimers = new Set<TimeoutHandle>();

  function sendSubscribe(connection: KlineConnection, keys: string[]) {
    if (keys.length === 0 || !connection.client.isConnected()) {
      return;
    }

    const gen = ++connection.subscribeGeneration;
    const chunks = chunk(keys, chunkSize);

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
          params: group.map(klineStream),
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

  function createConnection(keys: string[]): KlineConnection {
    const connection: KlineConnection = {
      keys: [...keys],
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
          sendSubscribe(connection, connection.keys);
        },
        onMessage(data) {
          const payload = parseJsonPayload(data);

          if (payload === null) {
            return;
          }

          const kline = parseLiveKline(payload);

          if (!kline) {
            return;
          }

          if (refs.get(klineSubscriptionKey(kline.symbol, kline.interval))) {
            options.onKline(kline);
          }
        },
      }),
    };

    return connection;
  }

  function reconcile() {
    const buckets = chunk([...desired].sort(), maxStreams);

    while (connections.length > buckets.length) {
      const removed = connections.pop();

      if (removed?.client.isConnected() && removed.keys.length > 0) {
        removed.client.send(
          JSON.stringify({
            method: "UNSUBSCRIBE",
            params: removed.keys.map(klineStream),
            id: requestId,
          }),
        );
        requestId += 1;
      }

      removed?.client.stop();
    }

    buckets.forEach((keys, index) => {
      const existing = connections[index];

      if (!existing) {
        const created = createConnection(keys);
        connections.push(created);

        if (started) {
          created.client.start();
        }

        return;
      }

      const previousKeys = existing.keys;
      existing.keys = [...keys];

      if (!started || !existing.client.isConnected() || sameKeySet(previousKeys, existing.keys)) {
        return;
      }

      existing.subscribeGeneration += 1;
      const previousSet = new Set(previousKeys);
      const added = keys.filter((key) => !previousSet.has(key));
      const removed = previousKeys.filter((key) => !keys.includes(key));

      if (removed.length > 0) {
        existing.client.send(
          JSON.stringify({
            method: "UNSUBSCRIBE",
            params: removed.map(klineStream),
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
      refs.clear();

      for (const timer of pendingTimers) {
        scheduler.clearTimeout(timer);
      }

      pendingTimers.clear();

      for (const connection of connections) {
        connection.client.stop();
      }

      connections.length = 0;
    },
    acquire(symbol, interval) {
      const key = klineSubscriptionKey(symbol, interval);
      const next = (refs.get(key) ?? 0) + 1;
      refs.set(key, next);

      if (next === 1) {
        desired.add(key);
        reconcile();
      }
    },
    release(symbol, interval) {
      const key = klineSubscriptionKey(symbol, interval);
      const current = refs.get(key) ?? 0;

      if (current <= 0) {
        return;
      }

      if (current === 1) {
        refs.delete(key);
        desired.delete(key);
        reconcile();
        return;
      }

      refs.set(key, current - 1);
    },
    refCount(symbol, interval) {
      return refs.get(klineSubscriptionKey(symbol, interval)) ?? 0;
    },
    isConnected() {
      if (desired.size === 0) {
        return true;
      }

      return connections.length > 0 && connections.every((connection) => connection.client.isConnected());
    },
  };
}

export function klineSubscriptionKey(symbol: string, interval: CandleInterval): string {
  return `${symbol}|${interval}`;
}

export function klineStream(key: string): string {
  const sep = key.lastIndexOf("|");
  const symbol = sep === -1 ? key : key.slice(0, sep);
  const interval = sep === -1 ? "" : key.slice(sep + 1);
  return `${symbol.toLowerCase()}@kline_${interval}`;
}

function sameKeySet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((key) => rightSet.has(key));
}
