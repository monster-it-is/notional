import type { MarketBboMessage, MarketMarkMessage } from "@notional/contracts";

import type { Scheduler, TimeoutHandle } from "../market-data/types.js";
import { MARKET_BACKPRESSURE_BYTES } from "./constants.js";

export type MarketLatestSource = {
  getLatestBook(symbol: string): Omit<MarketBboMessage, "type"> | null;
  getLatestMark(symbol: string): Omit<MarketMarkMessage, "type"> | null;
};

export type MarketClient = {
  id: string;
  subscriptions: Set<string>;
  bufferedAmount(): number;
  sendJson(payload: unknown): void;
};

export type MarketFanout = {
  noteBook(symbol: string): void;
  noteMark(symbol: string): void;
  addClient(client: MarketClient): void;
  removeClient(client: MarketClient): void;
  snapshot(symbol: string): { book: MarketBboMessage | null; mark: MarketMarkMessage | null };
  sendSnapshot(client: MarketClient, symbol: string): void;
  shutdown(): void;
};

export function createMarketFanout(options: {
  scheduler: Scheduler;
  coalesceMs: number;
  latest: MarketLatestSource;
  backpressureBytes?: number;
}): MarketFanout {
  const backpressureBytes = options.backpressureBytes ?? MARKET_BACKPRESSURE_BYTES;
  const clients = new Set<MarketClient>();
  const pendingBooks = new Map<string, MarketBboMessage>();
  const pendingMarks = new Map<string, MarketMarkMessage>();
  let timer: TimeoutHandle | undefined;
  let stopped = false;

  function bookFrame(symbol: string): MarketBboMessage | null {
    const latest = options.latest.getLatestBook(symbol);

    if (!latest) {
      return null;
    }

    return { type: "market.bbo", ...latest };
  }

  function markFrame(symbol: string): MarketMarkMessage | null {
    const latest = options.latest.getLatestMark(symbol);

    if (!latest) {
      return null;
    }

    return { type: "market.mark", ...latest };
  }

  function sendToClient(client: MarketClient, payload: unknown): void {
    if (client.bufferedAmount() > backpressureBytes) {
      return;
    }

    try {
      client.sendJson(payload);
    } catch {
      // Market frames are replaceable; contain send errors per client.
    }
  }

  function flush(): void {
    timer = undefined;

    if (stopped) {
      return;
    }

    const books = [...pendingBooks.values()];
    const marks = [...pendingMarks.values()];
    pendingBooks.clear();
    pendingMarks.clear();

    for (const client of clients) {
      for (const frame of books) {
        if (client.subscriptions.has(frame.symbol)) {
          sendToClient(client, frame);
        }
      }

      for (const frame of marks) {
        if (client.subscriptions.has(frame.symbol)) {
          sendToClient(client, frame);
        }
      }
    }

    if (clients.size > 0 && (pendingBooks.size > 0 || pendingMarks.size > 0)) {
      arm();
    }
  }

  function arm(): void {
    if (stopped || timer || clients.size === 0) {
      return;
    }

    timer = options.scheduler.setTimeout(flush, options.coalesceMs);
  }

  function disarm(): void {
    if (timer) {
      options.scheduler.clearTimeout(timer);
      timer = undefined;
    }
  }

  return {
    noteBook(symbol) {
      if (stopped) {
        return;
      }

      const frame = bookFrame(symbol);

      if (!frame) {
        return;
      }

      pendingBooks.set(symbol, frame);
      arm();
    },
    noteMark(symbol) {
      if (stopped) {
        return;
      }

      const frame = markFrame(symbol);

      if (!frame) {
        return;
      }

      pendingMarks.set(symbol, frame);
      arm();
    },
    addClient(client) {
      clients.add(client);
    },
    removeClient(client) {
      clients.delete(client);

      if (clients.size === 0) {
        disarm();
        pendingBooks.clear();
        pendingMarks.clear();
      }
    },
    snapshot(symbol) {
      return {
        book: bookFrame(symbol),
        mark: markFrame(symbol),
      };
    },
    sendSnapshot(client, symbol) {
      const { book, mark } = this.snapshot(symbol);

      if (book) {
        sendToClient(client, book);
      }

      if (mark) {
        sendToClient(client, mark);
      }
    },
    shutdown() {
      stopped = true;
      disarm();
      pendingBooks.clear();
      pendingMarks.clear();
      clients.clear();
    },
  };
}
