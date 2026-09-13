export type Logger = {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
};

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

export type Clock = {
  now(): number;
};

export type TimeoutHandle = {
  unref?: () => void;
};

export type Scheduler = Clock & {
  setTimeout(callback: () => void, ms: number): TimeoutHandle;
  clearTimeout(handle: TimeoutHandle): void;
};

export const systemClock: Clock = {
  now: () => Date.now(),
};

export const systemScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout(callback, ms) {
    return setTimeout(callback, ms);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export type MarkTick = {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingTime: number;
  markEventTime: number;
};

export type BookTick = {
  symbol: string;
  bestBidPrice: string;
  bestBidQty: string;
  bestAskPrice: string;
  bestAskQty: string;
  bookUpdateId: number;
  bookEventTime: number;
};

export type MarkState = MarkTick & {
  markReceivedAt: number;
};

export type BookState = BookTick & {
  bookReceivedAt: number;
};

export type SymbolMarketState = {
  symbol: string;
  mark?: MarkState;
  book?: BookState;
};
