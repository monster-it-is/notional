export type SymbolCycleScheduler = {
  schedule(symbol: string): void;
  stop(): void;
  waitForIdle(): Promise<void>;
};

export function resolvePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

export function createSymbolCycleScheduler(options: {
  maxConcurrent: number;
  run(symbol: string): Promise<void>;
  onError?(symbol: string, error: unknown): void;
}): SymbolCycleScheduler {
  const maxConcurrent = resolvePositiveInteger(options.maxConcurrent, "maxConcurrent");
  const pendingOrder: string[] = [];
  const pending = new Set<string>();
  const inFlight = new Set<string>();
  const dirty = new Set<string>();
  const running = new Map<string, Promise<void>>();
  let stopped = false;

  function enqueue(symbol: string): void {
    if (inFlight.has(symbol) || pending.has(symbol)) {
      return;
    }

    pending.add(symbol);
    pendingOrder.push(symbol);
  }

  function start(symbol: string): void {
    inFlight.add(symbol);
    const done = options
      .run(symbol)
      .catch((error: unknown) => {
        options.onError?.(symbol, error);
      })
      .finally(() => {
        inFlight.delete(symbol);
        running.delete(symbol);

        if (!stopped && dirty.delete(symbol)) {
          enqueue(symbol);
        }

        pump();
      });
    running.set(symbol, done);
  }

  function pump(): void {
    if (stopped) {
      return;
    }

    while (inFlight.size < maxConcurrent && pendingOrder.length > 0) {
      const symbol = pendingOrder.shift();
      if (symbol === undefined) {
        break;
      }

      pending.delete(symbol);
      start(symbol);
    }
  }

  function schedule(symbol: string): void {
    if (stopped) {
      return;
    }

    if (inFlight.has(symbol)) {
      dirty.add(symbol);
      return;
    }

    enqueue(symbol);
    pump();
  }

  function stop(): void {
    stopped = true;
    pendingOrder.length = 0;
    pending.clear();
    dirty.clear();
  }

  async function waitForIdle(): Promise<void> {
    for (;;) {
      if (!stopped) {
        pump();
      }

      const inflight = [...running.values()];
      if (inflight.length === 0) {
        if (stopped || pendingOrder.length === 0) {
          return;
        }

        pump();
        if (running.size === 0) {
          return;
        }

        continue;
      }

      await Promise.all(inflight);
    }
  }

  return { schedule, stop, waitForIdle };
}
