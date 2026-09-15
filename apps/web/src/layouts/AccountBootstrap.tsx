import type { AccountResponse } from "@notional/contracts";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { runAccountBootstrap } from "../auth/account-bootstrap.ts";
import { Header } from "../components/Header.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ErrorBanner } from "../components/ui/ErrorBanner.tsx";
import { useAccountSocket } from "../hooks/use-account-socket.ts";
import { invalidateAfterInitialize } from "../realtime/invalidate.ts";

type BootstrapStatus = "loading_account" | "initializing" | "ready" | "error";

type AccountBootstrapValue = {
  status: BootstrapStatus;
  account: AccountResponse | null;
  retry: () => void;
};

const AccountBootstrapContext = createContext<AccountBootstrapValue | null>(null);

export function useAccountBootstrap(): AccountBootstrapValue {
  const value = useContext(AccountBootstrapContext);

  if (!value) {
    throw new Error("useAccountBootstrap must be used within AccountBootstrap");
  }

  return value;
}

export function AccountBootstrap({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<BootstrapStatus>("loading_account");
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    function onUninitialized() {
      setAttempt((value) => value + 1);
    }

    window.addEventListener("notional:account-uninitialized", onUninitialized);
    return () => {
      window.removeEventListener("notional:account-uninitialized", onUninitialized);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading_account");
    setError(null);

    void runAccountBootstrap().then((result) => {
      if (cancelled) {
        return;
      }

      if (result.kind === "ready") {
        if (result.initialized) {
          invalidateAfterInitialize(queryClient);
        }

        setAccount(result.account);
        setStatus("ready");
        return;
      }

      if (result.kind === "unauthorized") {
        window.location.assign("/signin");
        return;
      }

      setError(result.kind === "error" ? result.error : new Error("ACCOUNT_NOT_INITIALIZED"));
      setStatus("error");
    });

    return () => {
      cancelled = true;
    };
  }, [attempt, queryClient]);

  useAccountSocket(status === "ready");

  const value = { status, account, retry };

  if (status === "loading_account" || status === "initializing") {
    return (
      <AccountBootstrapContext.Provider value={value}>
        <Header signedIn />
        <p className="p-6 text-sm text-app-text">Preparing paper account…</p>
      </AccountBootstrapContext.Provider>
    );
  }

  if (status === "error") {
    return (
      <AccountBootstrapContext.Provider value={value}>
        <Header signedIn />
        <div className="mx-auto max-w-lg space-y-4 p-6">
          <h1 className="text-xl">Paper account unavailable</h1>
          <ErrorBanner error={error} />
          <Button type="button" variant="primary" onClick={retry}>
            Retry
          </Button>
        </div>
      </AccountBootstrapContext.Provider>
    );
  }

  return <AccountBootstrapContext.Provider value={value}>{children}</AccountBootstrapContext.Provider>;
}
