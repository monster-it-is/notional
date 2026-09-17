import type { Scheduler, TimeoutHandle } from "./types.js";
import type { WsConnection, WsTransport } from "./ws-transport.js";

export class FakeScheduler implements Scheduler {
  nowMs = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { due: number; callback: () => void }>();

  now(): number {
    return this.nowMs;
  }

  get pendingCount(): number {
    return this.timers.size;
  }

  setTimeout(callback: () => void, ms: number): TimeoutHandle {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { due: this.nowMs + ms, callback });
    return { id } as TimeoutHandle & { id: number };
  }

  clearTimeout(handle: TimeoutHandle): void {
    const id = (handle as TimeoutHandle & { id?: number }).id;
    if (id !== undefined) {
      this.timers.delete(id);
    }
  }

  advance(ms: number): void {
    this.nowMs += ms;
    this.flushDue();
  }

  flushDue(): void {
    let progressed = true;

    while (progressed) {
      progressed = false;

      for (const [id, timer] of [...this.timers.entries()]) {
        if (timer.due <= this.nowMs) {
          this.timers.delete(id);
          timer.callback();
          progressed = true;
        }
      }
    }
  }
}

export class FakeSocket implements WsConnection {
  readonly sent: string[] = [];
  private readonly openHandlers: Array<() => void> = [];
  private readonly messageHandlers: Array<(data: string) => void> = [];
  private readonly closeHandlers: Array<() => void> = [];
  private readonly errorHandlers: Array<(error: Error) => void> = [];
  private closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    for (const handler of this.closeHandlers) {
      handler();
    }
  }

  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  open(): void {
    for (const handler of this.openHandlers) {
      handler();
    }
  }

  emit(data: string): void {
    for (const handler of this.messageHandlers) {
      handler(data);
    }
  }
}

export class FakeTransport implements WsTransport {
  readonly sockets: FakeSocket[] = [];
  readonly urls: string[] = [];

  connect(url: string): WsConnection {
    const socket = new FakeSocket();
    this.urls.push(url);
    this.sockets.push(socket);
    return socket;
  }
}
