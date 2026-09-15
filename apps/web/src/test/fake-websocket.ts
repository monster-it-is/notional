export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readonly url: string;
  readyState = 0;
  private readonly listeners: Record<string, Array<(event: { data?: unknown; code?: number; reason?: string }) => void>> =
    {
      open: [],
      message: [],
      close: [],
      error: [],
    };

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  addEventListener(
    type: string,
    listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
  ): void {
    this.listeners[type]?.push(listener);
  }

  removeEventListener(): void {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    for (const listener of this.listeners.close) {
      listener({ code, reason });
    }
  }

  open(): void {
    this.readyState = 1;
    for (const listener of this.listeners.open) {
      listener({});
    }
  }

  emit(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    for (const listener of this.listeners.message) {
      listener({ data });
    }
  }

  error(): void {
    for (const listener of this.listeners.error) {
      listener({});
    }
  }
}
