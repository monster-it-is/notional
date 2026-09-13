import type { MarketDataResponse, MarketDataStatusResponse } from "@notional/contracts";
import {
  db,
  listActiveInstruments,
  listInstrumentSymbols,
} from "@notional/db";

import type { ApiEnv } from "../env.js";
import { createBookTickerFeed, type BookTickerFeed } from "./book-ticker-feed.js";
import { syncInstrumentCatalog } from "./instrument-sync.js";
import {
  createMarketDataStore,
  type FreshBook,
  type FreshMark,
  type MarketDataStore,
} from "./market-data-store.js";
import {
  parseBookTickerTicks,
  parseJsonPayload,
  parseMarkTicks,
  parsePremiumIndexTicks,
} from "./parse-events.js";
import { createBinanceRestClient } from "./rest-client.js";
import {
  silentLogger,
  systemScheduler,
  type Logger,
  type Scheduler,
  type TimeoutHandle,
} from "./types.js";
import { createReconnectingWsClient, type ReconnectingWsClient } from "./ws-client.js";
import { createNodeWsTransport, type WsTransport } from "./ws-transport.js";

export type MarketDataAccess = {
  getReadySnapshot(symbol: string): MarketDataResponse | null;
  getFreshMark(symbol: string): FreshMark | null;
  getFreshBook(symbol: string): FreshBook | null;
  getStatus(): MarketDataStatusResponse;
};

export type MarketDataRuntime = MarketDataAccess & {
  store: MarketDataStore;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function unavailableMarketDataAccess(): MarketDataAccess {
  return {
    getReadySnapshot() {
      return null;
    },
    getFreshMark() {
      return null;
    },
    getFreshBook() {
      return null;
    },
    getStatus() {
      return {
        catalogSyncOk: false,
        catalogSyncedAt: null,
        marketWsConnected: false,
        publicWsConnected: false,
        readySymbolCount: 0,
      };
    },
  };
}

export function createMarketDataRuntime(options: {
  env: ApiEnv;
  store?: MarketDataStore;
  transport?: WsTransport;
  fetchImpl?: typeof fetch;
  scheduler?: Scheduler;
  random?: () => number;
  logger?: Logger;
  connectionMaxMs?: number;
}): MarketDataRuntime {
  const env = options.env;
  const logger = options.logger ?? silentLogger;
  const scheduler = options.scheduler ?? systemScheduler;
  const store = options.store ?? createMarketDataStore(scheduler);
  const transport = options.transport ?? createNodeWsTransport();
  const abort = new AbortController();
  const rest = createBinanceRestClient({
    restBaseUrl: env.BINANCE_FAPI_REST_BASE_URL,
    timeoutMs: env.BINANCE_HTTP_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
    signal: abort.signal,
  });

  let catalogSymbols = new Set<string>();
  let catalogSyncOk = false;
  let catalogSyncedAt: number | null = null;
  let syncing = false;
  let syncTimer: TimeoutHandle | undefined;
  let markWs: ReconnectingWsClient | undefined;
  let bookFeed: BookTickerFeed | undefined;
  let started = false;

  function getReadySnapshot(symbol: string): MarketDataResponse | null {
    return store.getReadySnapshot(
      symbol,
      env.MARKET_DATA_MARK_STALE_MS,
      env.MARKET_DATA_BOOK_STALE_MS,
    );
  }

  function getFreshMark(symbol: string): FreshMark | null {
    return store.getFreshMark(symbol, env.MARKET_DATA_MARK_STALE_MS);
  }

  function getFreshBook(symbol: string): FreshBook | null {
    return store.getFreshBook(symbol, env.MARKET_DATA_BOOK_STALE_MS);
  }

  async function refreshCatalogSymbols() {
    catalogSymbols = new Set(await listInstrumentSymbols(db));
  }

  async function bootstrapRest() {
    if (catalogSymbols.size === 0) {
      return;
    }

    try {
      const [premium, books] = await Promise.all([
        rest.getPremiumIndex(),
        rest.getBookTicker(),
      ]);

      for (const tick of parsePremiumIndexTicks(premium)) {
        if (catalogSymbols.has(tick.symbol)) {
          store.applyMark(tick);
        }
      }

      const active = new Set((await listActiveInstruments(db)).map((row) => row.symbol));

      for (const tick of parseBookTickerTicks(books)) {
        if (active.has(tick.symbol)) {
          store.applyBook(tick);
        }
      }
    } catch (error) {
      logger.warn("market-data REST bootstrap failed", {
        detail: error instanceof Error ? error.message : "bootstrap failed",
      });
    }
  }

  async function syncOnce() {
    if (syncing || abort.signal.aborted) {
      return;
    }

    syncing = true;

    try {
      const result = await syncInstrumentCatalog({
        fetchExchangeInfo: () => rest.getExchangeInfo(),
        logger,
      });

      if (!result.ok) {
        catalogSyncOk = false;
        return;
      }

      catalogSyncOk = true;
      catalogSyncedAt = scheduler.now();
      await refreshCatalogSymbols();
      const active = (await listActiveInstruments(db)).map((row) => row.symbol);
      bookFeed?.setSymbols(active);
      await bootstrapRest();
    } finally {
      syncing = false;
    }
  }

  function scheduleSync() {
    syncTimer = scheduler.setTimeout(() => {
      void syncOnce().then(() => {
        if (!abort.signal.aborted) {
          scheduleSync();
        }
      });
    }, env.INSTRUMENT_SYNC_INTERVAL_MS);
  }

  return {
    store,
    getReadySnapshot,
    getFreshMark,
    getFreshBook,
    getStatus() {
      return {
        catalogSyncOk,
        catalogSyncedAt,
        marketWsConnected: markWs?.isConnected() ?? false,
        publicWsConnected: bookFeed?.isConnected() ?? false,
        readySymbolCount: store.countReady(
          env.MARKET_DATA_MARK_STALE_MS,
          env.MARKET_DATA_BOOK_STALE_MS,
        ),
      };
    },
    async start() {
      if (started) {
        return;
      }

      started = true;
      markWs = createReconnectingWsClient({
        url: markPriceStreamUrl(env.BINANCE_FAPI_MARKET_WS_BASE_URL),
        transport,
        reconnectMaxMs: env.BINANCE_WS_RECONNECT_MAX_MS,
        scheduler,
        random: options.random,
        connectionMaxMs: options.connectionMaxMs,
        logger,
        onMessage(data) {
          const payload = parseJsonPayload(data);

          if (payload === null) {
            return;
          }

          for (const tick of parseMarkTicks(payload)) {
            if (catalogSymbols.has(tick.symbol)) {
              store.applyMark(tick);
            }
          }
        },
      });
      bookFeed = createBookTickerFeed({
        publicWsBaseUrl: env.BINANCE_FAPI_PUBLIC_WS_BASE_URL,
        transport,
        reconnectMaxMs: env.BINANCE_WS_RECONNECT_MAX_MS,
        scheduler,
        random: options.random,
        connectionMaxMs: options.connectionMaxMs,
        logger,
        onBook(tick) {
          if (catalogSymbols.has(tick.symbol)) {
            store.applyBook(tick);
          }
        },
      });

      await refreshCatalogSymbols();
      await syncOnce();
      markWs.start();
      bookFeed.start();
      scheduleSync();
    },
    async stop() {
      abort.abort();
      started = false;

      if (syncTimer) {
        scheduler.clearTimeout(syncTimer);
        syncTimer = undefined;
      }

      markWs?.stop();
      bookFeed?.stop();
    },
  };
}

export function markPriceStreamUrl(marketWsBaseUrl: string): string {
  const base = marketWsBaseUrl.replace(/\/$/, "");
  return `${base}/stream?streams=${encodeURIComponent("!markPrice@arr@1s")}`;
}
