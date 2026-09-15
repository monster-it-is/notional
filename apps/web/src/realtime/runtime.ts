import type { QueryClient } from "@tanstack/react-query";

import { authClient } from "../auth/auth-client.ts";
import { getAccount } from "../lib/api/account.ts";
import { isAccountNotInitialized, isUnauthorized } from "../lib/api/errors.ts";
import { accountWsUrl, marketWsUrl } from "../lib/env.ts";
import { AccountSocketManager } from "./account-socket.ts";
import {
  invalidateAllPrivateResources,
  invalidatePrivateResources,
} from "./invalidate.ts";
import { MarketSocketManager } from "./market-socket.ts";
import { useMarketStore } from "../stores/market-store.ts";
import { useRealtimeStatusStore } from "../stores/realtime-status-store.ts";

let accountSocket: AccountSocketManager | null = null;
let marketSocket: MarketSocketManager | null = null;
let signedOutHandler: (() => void) | null = null;
let uninitializedHandler: (() => void) | null = null;

export function setRealtimeAuthHandlers(handlers: {
  onSignedOut: () => void;
  onUninitialized: () => void;
}): void {
  signedOutHandler = handlers.onSignedOut;
  uninitializedHandler = handlers.onUninitialized;
}

export function configureRealtime(queryClient: QueryClient): {
  accountSocket: AccountSocketManager;
  marketSocket: MarketSocketManager;
} {
  accountSocket = new AccountSocketManager({
    url: accountWsUrl,
    getSession: async () => {
      const result = await authClient.getSession();
      return result.data !== null;
    },
    probeAccount: async () => {
      try {
        await getAccount();
        return "ok";
      } catch (error) {
        if (isUnauthorized(error)) {
          return "unauthorized";
        }

        if (isAccountNotInitialized(error)) {
          return "uninitialized";
        }

        return "error";
      }
    },
    onInvalidate: (resources) => {
      invalidatePrivateResources(queryClient, resources);
    },
    onReconnectReady: () => {
      invalidateAllPrivateResources(queryClient);
    },
    onSignedOut: () => {
      signedOutHandler?.();
    },
    onUninitialized: () => {
      uninitializedHandler?.();
    },
    setStatus: (status) => {
      useRealtimeStatusStore.getState().setAccount(status);
    },
  });

  marketSocket = new MarketSocketManager({
    url: marketWsUrl,
    onBbo: (message) => {
      useMarketStore.getState().applyBbo(message);
    },
    onMark: (message) => {
      useMarketStore.getState().applyMark(message);
    },
    setStatus: (status) => {
      useRealtimeStatusStore.getState().setMarket(status);
    },
  });

  return { accountSocket, marketSocket };
}

export function getAccountSocket(): AccountSocketManager {
  if (!accountSocket) {
    throw new Error("account socket is not configured");
  }

  return accountSocket;
}

export function getMarketSocket(): MarketSocketManager {
  if (!marketSocket) {
    throw new Error("market socket is not configured");
  }

  return marketSocket;
}

export function stopRealtime(): void {
  accountSocket?.stop();
  marketSocket?.stop();
}
