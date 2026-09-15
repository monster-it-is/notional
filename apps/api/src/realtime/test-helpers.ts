export class FakeRealtimeSocket {
  readonly sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  bufferedAmount = 0;
  private readonly messageHandlers: Array<(data: unknown) => void> = [];
  private readonly closeHandlers: Array<() => void> = [];

  send(data: string): void {
    if (this.closed) {
      throw new Error("socket closed");
    }

    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) {
      return;
    }

    this.closed = { code, reason };

    for (const handler of this.closeHandlers) {
      handler();
    }
  }

  getBufferedAmount(): number {
    return this.bufferedAmount;
  }

  onMessage(handler: (data: unknown) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  emit(data: unknown): void {
    for (const handler of this.messageHandlers) {
      handler(data);
    }
  }

  parsed(): unknown[] {
    return this.sent.map((row) => JSON.parse(row) as unknown);
  }
}
