import type { OrderStatus } from "@notional/contracts";

export const queryKeys = {
  account: ["account"] as const,
  instruments: ["instruments"] as const,
  instrument: (symbol: string) => ["instruments", symbol] as const,
  orders: {
    all: ["orders"] as const,
    list: (filters: {
      status?: OrderStatus;
      symbol?: string;
      limit?: number;
      offset?: number;
    }) => ["orders", "list", filters] as const,
    detail: (id: string) => ["orders", id] as const,
  },
  positions: {
    all: ["positions"] as const,
    symbol: (symbol: string) => ["positions", symbol] as const,
  },
  executions: {
    all: ["executions"] as const,
    list: (filters: {
      symbol?: string;
      orderId?: string;
      limit?: number;
      offset?: number;
    }) => ["executions", "list", filters] as const,
  },
  perpFunding: {
    all: ["perpFunding"] as const,
    list: (filters: { limit?: number; offset?: number }) =>
      ["perpFunding", "list", filters] as const,
  },
  walletFunding: {
    all: ["walletFunding"] as const,
    list: (filters: { limit?: number; offset?: number }) =>
      ["walletFunding", "list", filters] as const,
  },
  liquidations: {
    all: ["liquidations"] as const,
    list: (filters: { limit?: number; offset?: number }) =>
      ["liquidations", "list", filters] as const,
  },
  marginSettings: {
    all: ["marginSettings"] as const,
    symbol: (symbol: string) => ["marginSettings", symbol] as const,
  },
};
