import type { CandleInterval, MarketCandleMessage } from "@notional/contracts";
import { CANDLE_INTERVALS } from "@notional/contracts";

import { MARKET_BACKPRESSURE_BYTES, MAX_CANDLE_SUBSCRIPTIONS } from "./constants.js";
import type { MarketClient } from "./market-fanout.js";

const INTERVALS = new Set<string>(CANDLE_INTERVALS);

type PairHold = {
  closed: MarketCandleMessage | null;
  latest: MarketCandleMessage | null;
};

export type CandleFanout = {
  noteCandle(message: MarketCandleMessage): void;
  addClient(client: MarketClient): void;
  removeClient(client: MarketClient): void;
  removeSubscription(client: MarketClient, symbol: string, interval: CandleInterval): void;
  shutdown(): void;
};

export function createCandleFanout(options?: {
  backpressureBytes?: number;
  onOverflow?: (client: MarketClient) => void;
}): CandleFanout {
  const backpressureBytes = options?.backpressureBytes ?? MARKET_BACKPRESSURE_BYTES;
  const clients = new Set<MarketClient>();
  const pending = new Map<string, Map<string, PairHold>>();
  let stopped = false;

  function writable(client: MarketClient): boolean {
    return client.bufferedAmount() <= backpressureBytes;
  }

  function sendFrame(client: MarketClient, payload: MarketCandleMessage): boolean {
    if (!writable(client)) {
      return false;
    }

    try {
      client.sendJson(payload);
      return true;
    } catch {
      return false;
    }
  }

  function pairMap(client: MarketClient): Map<string, PairHold> | undefined {
    return pending.get(client.id);
  }

  function slotFor(client: MarketClient, key: string): PairHold {
    return pairMap(client)?.get(key) ?? { closed: null, latest: null };
  }

  function commit(client: MarketClient, key: string, slot: PairHold): void {
    let byPair = pairMap(client);

    if (!byPair) {
      byPair = new Map();
      pending.set(client.id, byPair);
    }

    byPair.set(key, slot);
  }

  function dropPair(client: MarketClient, key: string): void {
    const byPair = pairMap(client);

    if (!byPair) {
      return;
    }

    byPair.delete(key);

    if (byPair.size === 0) {
      pending.delete(client.id);
    }
  }

  function applyHold(slot: PairHold, message: MarketCandleMessage): PairHold | "overflow" {
    const next: PairHold = { closed: slot.closed, latest: slot.latest };

    if (!message.isClosed) {
      if (next.closed && message.openTime <= next.closed.openTime) {
        return next;
      }

      if (next.latest) {
        if (message.openTime < next.latest.openTime) {
          return next;
        }

        if (message.openTime === next.latest.openTime) {
          if (!next.latest.isClosed) {
            next.latest = message;
          }

          return next;
        }

        if (next.latest.isClosed) {
          return "overflow";
        }
      }

      next.latest = message;
      return next;
    }

    if (next.closed && message.openTime === next.closed.openTime) {
      next.closed = message;
      return next;
    }

    if (next.latest && message.openTime === next.latest.openTime) {
      next.latest = message;
      return next;
    }

    if (next.closed && next.latest?.isClosed) {
      return "overflow";
    }

    if (!next.closed) {
      next.closed = message;

      if (next.latest && next.latest.openTime <= message.openTime) {
        next.latest = null;
      }

      return next;
    }

    if (message.openTime > next.closed.openTime) {
      next.latest = message;
      return next;
    }

    return next;
  }

  function hold(client: MarketClient, message: MarketCandleMessage): "held" | "overflow" {
    const key = candleSubscriptionKey(message.symbol, message.interval);
    const byPair = pairMap(client);

    if (byPair && !byPair.has(key) && byPair.size >= MAX_CANDLE_SUBSCRIPTIONS) {
      return "held";
    }

    const applied = applyHold(slotFor(client, key), message);

    if (applied === "overflow") {
      return "overflow";
    }

    commit(client, key, applied);
    return "held";
  }

  function flushClient(client: MarketClient): void {
    const byPair = pairMap(client);

    if (!byPair) {
      return;
    }

    for (const [key, slot] of byPair) {
      if (!client.candleSubscriptions.has(key)) {
        byPair.delete(key);
        continue;
      }

      if (slot.closed) {
        if (!sendFrame(client, slot.closed)) {
          return;
        }

        slot.closed = null;
      }

      if (slot.latest) {
        if (!sendFrame(client, slot.latest)) {
          return;
        }

        slot.latest = null;
      }

      if (!slot.closed && !slot.latest) {
        byPair.delete(key);
      }
    }

    if (byPair.size === 0) {
      pending.delete(client.id);
    }
  }

  function deliver(client: MarketClient, message: MarketCandleMessage): void {
    if (hold(client, message) === "overflow") {
      if (writable(client)) {
        flushClient(client);
      }

      if (hold(client, message) === "overflow") {
        options?.onOverflow?.(client);
        return;
      }
    }

    if (writable(client)) {
      flushClient(client);
    }
  }

  return {
    noteCandle(message) {
      if (stopped) {
        return;
      }

      const key = candleSubscriptionKey(message.symbol, message.interval);

      for (const client of clients) {
        if (!client.candleSubscriptions.has(key)) {
          continue;
        }

        deliver(client, message);
      }
    },
    addClient(client) {
      clients.add(client);
    },
    removeClient(client) {
      clients.delete(client);
      pending.delete(client.id);
    },
    removeSubscription(client, symbol, interval) {
      dropPair(client, candleSubscriptionKey(symbol, interval));
    },
    shutdown() {
      stopped = true;
      clients.clear();
      pending.clear();
    },
  };
}

export function candleSubscriptionKey(symbol: string, interval: CandleInterval): string {
  return `${symbol}|${interval}`;
}

export function parseCandleSubscriptionKey(
  key: string,
): { symbol: string; interval: CandleInterval } | null {
  const sep = key.lastIndexOf("|");

  if (sep <= 0 || sep === key.length - 1) {
    return null;
  }

  const symbol = key.slice(0, sep);
  const interval = key.slice(sep + 1);

  if (!INTERVALS.has(interval)) {
    return null;
  }

  return { symbol, interval: interval as CandleInterval };
}
