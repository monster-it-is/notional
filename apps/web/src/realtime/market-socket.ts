import type { MarketBboMessage, MarketMarkMessage } from "@notional/contracts";

import type { ConnectionStatus, WebSocketLike } from "./reconnect.ts";
import { defaultCreateWebSocket, PING_INTERVAL_MS, reconnectDelay } from "./reconnect.ts";
import { inboundText, isValidHello, parseServerMessage } from "./parse-message.ts";

export type MarketSocketDeps = {
  url: () => string;
  createWebSocket?: (url: string) => WebSocketLike;
  onBbo: (message: MarketBboMessage) => void;
  onMark: (message: MarketMarkMessage) => void;
  setStatus: (status: ConnectionStatus) => void;
  random?: () => number;
};

export class MarketSocketManager {
  private readonly deps: MarketSocketDeps;
  private readonly createWebSocket: (url: string) => WebSocketLike;
  private socket: WebSocketLike | null = null;
  private refCount = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private protocolReady = false;
  private reconnectStopped = false;
  private desiredSymbol: string | null = null;
  private subscribedSymbol: string | null = null;
  private constructors = 0;

  constructor(deps: MarketSocketDeps) {
    this.deps = deps;
    this.createWebSocket = deps.createWebSocket ?? defaultCreateWebSocket;
  }

  get constructorCount(): number {
    return this.constructors;
  }

  acquire(): void {
    this.refCount += 1;

    if (this.releaseTimer !== null) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }

    if (this.refCount === 1) {
      this.reconnectStopped = false;
      this.connect();
    }
  }

  release(): void {
    this.refCount -= 1;

    if (this.refCount > 0) {
      return;
    }

    this.refCount = 0;
    this.releaseTimer = setTimeout(() => {
      this.disconnect();
    }, 50);
  }

  stop(): void {
    this.refCount = 0;
    this.disconnect();
  }

  setDesiredSymbol(symbol: string | null): void {
    const previous = this.desiredSymbol;
    this.desiredSymbol = symbol;

    if (!this.protocolReady || !this.socket) {
      return;
    }

    if (previous && previous !== symbol) {
      this.send({ type: "market.unsubscribe", symbol: previous });
      this.subscribedSymbol = null;
    }

    if (symbol && symbol !== this.subscribedSymbol) {
      this.send({ type: "market.subscribe", symbol });
      this.subscribedSymbol = symbol;
    }
  }

  connect(): void {
    if (this.reconnectStopped || this.socket) {
      return;
    }

    this.intentionalClose = false;
    this.protocolReady = false;
    this.subscribedSymbol = null;
    this.deps.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    this.constructors += 1;
    const socket = this.createWebSocket(this.deps.url());
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        return;
      }

      this.deps.setStatus("open_awaiting_hello");
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) {
        return;
      }

      this.onMessage(inboundText(event.data));
    });

    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.clearPing();
      this.onClose(event.code ?? 1006);
    });

    socket.addEventListener("error", () => {
      // Handshake HTTP status is not available to browser JS.
    });
  }

  private onMessage(raw: string | null): void {
    if (raw === null) {
      return;
    }

    const message = parseServerMessage(raw);

    if (!message) {
      return;
    }

    if (!this.protocolReady) {
      if (message.type !== "hello") {
        return;
      }

      if (!isValidHello(message, "market")) {
        this.failProtocol();
        return;
      }

      this.protocolReady = true;
      this.reconnectAttempt = 0;
      this.deps.setStatus("ready");
      this.startPing();
      this.resubscribe();
      return;
    }

    if (message.type === "market.bbo") {
      if (this.desiredSymbol && message.symbol === this.desiredSymbol) {
        this.deps.onBbo(message);
      }

      return;
    }

    if (message.type === "market.mark") {
      if (this.desiredSymbol && message.symbol === this.desiredSymbol) {
        this.deps.onMark(message);
      }
    }
  }

  private onClose(code: number): void {
    this.protocolReady = false;
    this.subscribedSymbol = null;

    if (this.intentionalClose || this.reconnectStopped) {
      if (!this.intentionalClose && this.reconnectStopped) {
        return;
      }

      this.deps.setStatus("closed");
      return;
    }

    this.scheduleReconnect(code === 1008);
  }

  private resubscribe(): void {
    if (!this.desiredSymbol || !this.socket) {
      return;
    }

    this.send({ type: "market.subscribe", symbol: this.desiredSymbol });
    this.subscribedSymbol = this.desiredSymbol;
  }

  private send(message: { type: string; symbol?: string }): void {
    this.socket?.send(JSON.stringify(message));
  }

  private failProtocol(): void {
    this.reconnectStopped = true;
    this.deps.setStatus("protocol_error");
    this.intentionalClose = true;
    this.socket?.close(1000, "PROTOCOL_MISMATCH");
    this.socket = null;
    this.clearPing();
  }

  private scheduleReconnect(slower: boolean): void {
    if (this.reconnectStopped || this.refCount <= 0) {
      this.deps.setStatus("closed");
      return;
    }

    this.deps.setStatus("reconnecting");
    const delay = reconnectDelay(this.reconnectAttempt, {
      slower,
      random: this.deps.random,
    });
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      this.socket?.send(JSON.stringify({ type: "ping" }));
    }, PING_INTERVAL_MS);
  }

  private clearPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private disconnect(): void {
    this.intentionalClose = true;
    this.reconnectStopped = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.releaseTimer !== null) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }

    this.clearPing();
    this.socket?.close(1000, "CLIENT_STOP");
    this.socket = null;
    this.protocolReady = false;
    this.subscribedSymbol = null;
    this.reconnectAttempt = 0;
    this.deps.setStatus("idle");
  }
}
