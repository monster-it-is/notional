import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { isApiError } from "../lib/api/errors.ts";
import { setUnauthorizedHandler } from "../lib/api/client.ts";
import { configureRealtime, setRealtimeAuthHandlers, stopRealtime } from "../realtime/runtime.ts";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { AppRouter } from "./router.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry(failureCount, error) {
        if (isApiError(error) && error.status !== 0) {
          return false;
        }

        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

configureRealtime(queryClient);
setRealtimeAuthHandlers({
  onSignedOut: () => {
    stopRealtime();
    queryClient.clear();
    void authClient.signOut();
    window.location.assign("/signin");
  },
  onUninitialized: () => {
    window.dispatchEvent(new Event("notional:account-uninitialized"));
  },
});
setUnauthorizedHandler(() => {
  stopRealtime();
  queryClient.clear();
  void authClient.signOut();
  window.location.assign("/signin");
});

export function AppProviders() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
