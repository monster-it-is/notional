import type {
  HelloMessage,
  RealtimeChannel,
  RealtimeErrorMessage,
} from "@notional/contracts";
import { REALTIME_PROTOCOL_VERSION } from "@notional/contracts";
import { db, findInstrumentBySymbol } from "@notional/db";
import type { IncomingHttpHeaders } from "node:http";

import type { Logger, Scheduler, TimeoutHandle } from "../market-data/types.js";
import { silentLogger, systemScheduler } from "../market-data/types.js";
import {
  MAX_INBOUND_PAYLOAD_BYTES,
  MAX_MARKET_SUBSCRIPTIONS,
} from "./constants.js";
import type { CommittedPrivateEffect } from "./effects.js";
import { safeOnPrivateCommitted } from "./effects.js";
import {
  createMarketFanout,
  type MarketClient,
  type MarketLatestSource,
} from "./market-fanout.js";
import { createPrivateEventBus, type AccountClient } from "./private-bus.js";
import { inboundByteLength, inboundText, parseClientMessage } from "./protocol.js";

export type RealtimeSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  getBufferedAmount(): number;
  onMessage(handler: (data: unknown) => void): void;
  onClose(handler: () => void): void;
};

export type SessionLookup = (
  headers: IncomingHttpHeaders,
) => Promise<{ userId: string } | null>;

export type InstrumentLookup = (symbol: string) => Promise<{ symbol: string } | null>;

type BoundConnection = {
  id: string;
  socket: RealtimeSocket;
  channel: RealtimeChannel;
  lastInboundAt: number;
  idleTimer?: TimeoutHandle;
  handshakeHeaders?: IncomingHttpHeaders;
  userId?: string;
  paperAccountId?: string;
  closed: boolean;
  inbound: Promise<void>;
  marketClient?: MarketClient;
  accountClient?: AccountClient;
};

export type RealtimeRuntime = {
  noteBook(symbol: string): void;
  noteMark(symbol: string): void;
  onPrivateCommitted(effect: CommittedPrivateEffect): void;
  attachMarketSocket(socket: RealtimeSocket): void;
  attachAccountSocket(
    socket: RealtimeSocket,
    binding: {
      userId: string;
      paperAccountId: string;
      handshakeHeaders: IncomingHttpHeaders;
    },
  ): void;
  shutdown(): Promise<void>;
};

export function createRealtimeRuntime(options: {
  latest: MarketLatestSource;
  scheduler?: Scheduler;
  coalesceMs: number;
  idleTimeoutMs: number;
  logger?: Logger;
  getSession?: SessionLookup;
  findInstrument?: InstrumentLookup;
}): RealtimeRuntime {
  const scheduler = options.scheduler ?? systemScheduler;
  const logger = options.logger ?? silentLogger;
  const findInstrument =
    options.findInstrument ?? ((symbol) => findInstrumentBySymbol(db, symbol));
  const fanout = createMarketFanout({
    scheduler,
    coalesceMs: options.coalesceMs,
    latest: options.latest,
  });
  const bus = createPrivateEventBus({ clock: scheduler });
  const connections = new Set<BoundConnection>();
  let nextId = 1;
  let stopped = false;

  function serverTime(): string {
    return new Date(scheduler.now()).toISOString();
  }

  function sendJson(socket: RealtimeSocket, payload: unknown): void {
    socket.send(JSON.stringify(payload));
  }

  function sendError(socket: RealtimeSocket, code: string, message: string): void {
    const error: RealtimeErrorMessage = { type: "error", code, message };
    sendJson(socket, error);
  }

  function sendHello(socket: RealtimeSocket, channel: RealtimeChannel): void {
    const hello: HelloMessage = {
      type: "hello",
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      channel,
      serverTime: serverTime(),
    };
    sendJson(socket, hello);
  }

  function clearIdle(connection: BoundConnection): void {
    if (connection.idleTimer) {
      scheduler.clearTimeout(connection.idleTimer);
      connection.idleTimer = undefined;
    }
  }

  function armIdle(connection: BoundConnection): void {
    clearIdle(connection);

    if (stopped || connection.closed) {
      return;
    }

    connection.idleTimer = scheduler.setTimeout(() => {
      void handleIdle(connection);
    }, options.idleTimeoutMs);
  }

  async function handleIdle(connection: BoundConnection): Promise<void> {
    if (stopped || connection.closed) {
      return;
    }

    if (connection.channel === "account" && !(await sessionStillValid(connection))) {
      closeConnection(connection, 4401, "AUTH_EXPIRED");
      return;
    }

    if (scheduler.now() - connection.lastInboundAt >= options.idleTimeoutMs) {
      closeConnection(connection, 4408, "HEARTBEAT_TIMEOUT");
      return;
    }

    armIdle(connection);
  }

  async function sessionStillValid(connection: BoundConnection): Promise<boolean> {
    if (!options.getSession || !connection.handshakeHeaders || !connection.userId) {
      return true;
    }

    try {
      const session = await options.getSession(connection.handshakeHeaders);
      return session !== null && session.userId === connection.userId;
    } catch (error) {
      logger.error("private websocket session revalidation failed", {
        detail: error instanceof Error ? error.message : "session revalidation failed",
      });
      return false;
    }
  }

  function detach(connection: BoundConnection): void {
    clearIdle(connection);

    if (connection.marketClient) {
      fanout.removeClient(connection.marketClient);
    }

    if (connection.accountClient) {
      bus.remove(connection.accountClient);
    }

    connections.delete(connection);
  }

  function closeConnection(connection: BoundConnection, code: number, reason: string): void {
    if (connection.closed) {
      return;
    }

    connection.closed = true;
    detach(connection);

    try {
      connection.socket.close(code, reason);
    } catch {
      // Ignore close failures.
    }
  }

  function bindSocket(connection: BoundConnection): void {
    connection.socket.onMessage((data) => {
      connection.inbound = connection.inbound
        .then(() => handleInbound(connection, data))
        .catch((error: unknown) => {
          logger.error("websocket inbound handler failed", {
            detail: error instanceof Error ? error.message : "websocket inbound handler failed",
          });
        });
    });
    connection.socket.onClose(() => {
      if (connection.closed) {
        return;
      }

      connection.closed = true;
      detach(connection);
    });
  }

  async function handleInbound(connection: BoundConnection, data: unknown): Promise<void> {
    if (stopped || connection.closed) {
      return;
    }

    const bytes = inboundByteLength(data);

    if (bytes > MAX_INBOUND_PAYLOAD_BYTES) {
      closeConnection(connection, 1009, "MESSAGE_TOO_BIG");
      return;
    }

    const text = inboundText(data);

    if (text === null) {
      sendError(connection.socket, "INVALID_JSON", "malformed message");
      closeConnection(connection, 1003, "UNSUPPORTED_DATA");
      return;
    }

    const parsed = parseClientMessage(text);

    if (!parsed.ok) {
      if (parsed.code === "INVALID_JSON") {
        sendError(connection.socket, parsed.code, parsed.message);
        closeConnection(connection, 1003, "UNSUPPORTED_DATA");
        return;
      }

      sendError(connection.socket, parsed.code, parsed.message);
      return;
    }

    connection.lastInboundAt = scheduler.now();
    armIdle(connection);

    if (connection.channel === "account") {
      if (!(await sessionStillValid(connection))) {
        closeConnection(connection, 4401, "AUTH_EXPIRED");
        return;
      }
    }

    const message = parsed.message;

    if (message.type === "ping") {
      sendJson(connection.socket, {
        type: "pong",
        ...(message.ts === undefined ? {} : { ts: message.ts }),
        serverTime: serverTime(),
      });
      return;
    }

    if (connection.channel !== "market" || !connection.marketClient) {
      sendError(connection.socket, "WRONG_CHANNEL", "market messages are not allowed on this socket");
      return;
    }

    if (message.type === "market.subscribe") {
      await handleSubscribe(connection.marketClient, connection.socket, message.symbol);
      return;
    }

    if (message.type === "market.unsubscribe") {
      connection.marketClient.subscriptions.delete(message.symbol);
    }
  }

  async function handleSubscribe(
    client: MarketClient,
    socket: RealtimeSocket,
    symbol: string,
  ): Promise<void> {
    const instrument = await findInstrument(symbol);

    if (!instrument) {
      sendError(socket, "INVALID_SYMBOL", "unknown symbol");
      return;
    }

    if (!client.subscriptions.has(instrument.symbol) && client.subscriptions.size >= MAX_MARKET_SUBSCRIPTIONS) {
      sendError(socket, "SUBSCRIBE_LIMIT", "subscription limit exceeded");
      return;
    }

    client.subscriptions.add(instrument.symbol);
    fanout.sendSnapshot(client, instrument.symbol);
  }

  function attach(
    socket: RealtimeSocket,
    channel: RealtimeChannel,
    binding?: {
      userId: string;
      paperAccountId: string;
      handshakeHeaders: IncomingHttpHeaders;
    },
  ): void {
    if (stopped) {
      socket.close(1001, "SHUTDOWN");
      return;
    }

    const connection: BoundConnection = {
      id: String(nextId),
      socket,
      channel,
      lastInboundAt: scheduler.now(),
      handshakeHeaders: binding?.handshakeHeaders,
      userId: binding?.userId,
      paperAccountId: binding?.paperAccountId,
      closed: false,
      inbound: Promise.resolve(),
    };
    nextId += 1;

    if (channel === "market") {
      const marketClient: MarketClient = {
        id: connection.id,
        subscriptions: new Set(),
        bufferedAmount: () => socket.getBufferedAmount(),
        sendJson: (payload) => sendJson(socket, payload),
      };
      connection.marketClient = marketClient;
      fanout.addClient(marketClient);
    } else if (binding) {
      const accountClient: AccountClient = {
        id: connection.id,
        paperAccountId: binding.paperAccountId,
        attachedAt: scheduler.now(),
        bufferedAmount: () => socket.getBufferedAmount(),
        sendJson: (payload) => sendJson(socket, payload),
        close: (code, reason) => closeConnection(connection, code, reason),
      };
      connection.accountClient = accountClient;
      bus.add(accountClient);
    }

    connections.add(connection);
    bindSocket(connection);
    sendHello(socket, channel);
    armIdle(connection);
  }

  return {
    noteBook(symbol) {
      fanout.noteBook(symbol);
    },
    noteMark(symbol) {
      fanout.noteMark(symbol);
    },
    onPrivateCommitted(effect) {
      if (stopped) {
        return;
      }

      safeOnPrivateCommitted((next) => bus.publish(next), effect, logger);
    },
    attachMarketSocket(socket) {
      attach(socket, "market");
    },
    attachAccountSocket(socket, binding) {
      attach(socket, "account", binding);
    },
    async shutdown() {
      stopped = true;
      fanout.shutdown();
      bus.shutdown();

      for (const connection of [...connections]) {
        closeConnection(connection, 1001, "SHUTDOWN");
      }
    },
  };
}

export function latestFromStore(store: {
  getState(symbol: string):
    | {
        mark?: {
          symbol: string;
          markPrice: string;
          indexPrice: string;
          fundingRate: string;
          nextFundingTime: number;
          markEventTime: number;
        };
        book?: {
          symbol: string;
          bestBidPrice: string;
          bestBidQty: string;
          bestAskPrice: string;
          bestAskQty: string;
          bookEventTime: number;
        };
      }
    | undefined;
}): MarketLatestSource {
  return {
    getLatestBook(symbol) {
      const book = store.getState(symbol)?.book;

      if (!book) {
        return null;
      }

      return {
        symbol: book.symbol,
        bestBidPrice: book.bestBidPrice,
        bestBidQty: book.bestBidQty,
        bestAskPrice: book.bestAskPrice,
        bestAskQty: book.bestAskQty,
        bookEventTime: book.bookEventTime,
      };
    },
    getLatestMark(symbol) {
      const mark = store.getState(symbol)?.mark;

      if (!mark) {
        return null;
      }

      return {
        symbol: mark.symbol,
        markPrice: mark.markPrice,
        indexPrice: mark.indexPrice,
        fundingRate: mark.fundingRate,
        nextFundingTime: mark.nextFundingTime,
        markEventTime: mark.markEventTime,
      };
    },
  };
}
