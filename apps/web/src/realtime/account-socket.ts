import type { PrivateResource } from "@notional/contracts";
import {
  WS_CLOSE_AUTH_EXPIRED,
  WS_CLOSE_PRIVATE_BACKPRESSURE,
} from "@notional/contracts";

import type { ConnectionStatus, WebSocketLike } from "./reconnect.ts";
import { defaultCreateWebSocket, PING_INTERVAL_MS, reconnectDelay } from "./reconnect.ts";
import { inboundText, isValidHello, parseServerMessage } from "./parse-message.ts";

export type AccountProbeResult = "ok" | "uninitialized" | "unauthorized" | "error";

export type AccountSocketDeps = {
  url: () => string;
  createWebSocket?: (url: string) => WebSocketLike;
  getSession: () => Promise<boolean>;
  probeAccount: () => Promise<AccountProbeResult>;
  onInvalidate: (resources: PrivateResource[]) => void;
  onReconnectReady: () => void;
  onSignedOut: () => void;
  onUninitialized: () => void;
  setStatus: (status: ConnectionStatus) => void;
  random?: () => number;
};

export class AccountSocketManager {
  private readonly deps: AccountSocketDeps;
  private readonly createWebSocket: (url: string) => WebSocketLike;
  private socket: WebSocketLike | null = null;
  private refCount = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private protocolReady = false;
  private hadSuccessfulReady = false;
  private reconnectStopped = false;
  private constructors = 0;

  constructor(deps: AccountSocketDeps) {
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

  connect(): void {
    if (this.reconnectStopped || this.socket) {
      return;
    }

    this.intentionalClose = false;
    this.protocolReady = false;
    this.deps.setStatus(this.hadSuccessfulReady ? "reconnecting" : "connecting");
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
      void this.onClose(event.code ?? 1006, event.reason ?? "");
    });

    socket.addEventListener("error", () => {
      // Handshake HTTP status is not available to browser JS. Close handler owns recovery.
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

      if (!isValidHello(message, "account")) {
        this.failProtocol();
        return;
      }

      const reconnecting = this.hadSuccessfulReady;
      this.protocolReady = true;
      this.hadSuccessfulReady = true;
      this.reconnectAttempt = 0;
      this.deps.setStatus("ready");
      this.startPing();

      if (reconnecting) {
        this.deps.onReconnectReady();
      }

      return;
    }

    if (message.type === "private.invalidate") {
      this.deps.onInvalidate(message.resources);
    }
  }

  private async onClose(code: number, _reason: string): Promise<void> {
    const closedBeforeHello = !this.protocolReady;
    this.protocolReady = false;

    if (this.intentionalClose) {
      this.deps.setStatus("closed");
      return;
    }

    if (code === WS_CLOSE_AUTH_EXPIRED) {
      this.reconnectStopped = true;
      this.deps.setStatus("auth_expired");
      const hasSession = await this.deps.getSession();

      if (!hasSession) {
        this.deps.onSignedOut();
      }

      return;
    }

    if (this.reconnectStopped) {
      return;
    }

    if (closedBeforeHello) {
      await this.handlePreReadyFailure();
      return;
    }

    this.scheduleReconnect(code === WS_CLOSE_PRIVATE_BACKPRESSURE || code === 1008);
  }

  private async handlePreReadyFailure(): Promise<void> {
    const hasSession = await this.deps.getSession();

    if (!hasSession) {
      this.reconnectStopped = true;
      this.deps.onSignedOut();
      this.deps.setStatus("closed");
      return;
    }

    const account = await this.deps.probeAccount();

    if (account === "unauthorized") {
      this.reconnectStopped = true;
      this.deps.onSignedOut();
      this.deps.setStatus("closed");
      return;
    }

    if (account === "uninitialized") {
      this.reconnectStopped = true;
      this.deps.onUninitialized();
      this.deps.setStatus("closed");
      return;
    }

    this.scheduleReconnect(false);
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
    this.hadSuccessfulReady = false;
    this.reconnectAttempt = 0;
    this.deps.setStatus("idle");
  }
}
