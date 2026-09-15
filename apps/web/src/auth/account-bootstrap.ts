import type { AccountResponse } from "@notional/contracts";

import { initializeAccount, getAccount } from "../lib/api/account.ts";
import { isAccountNotInitialized, isUnauthorized } from "../lib/api/errors.ts";

export type BootstrapKind = "ready" | "uninitialized" | "unauthorized" | "error";

export type BootstrapResult =
  | { kind: "ready"; account: AccountResponse; initialized: boolean }
  | { kind: "uninitialized" }
  | { kind: "unauthorized" }
  | { kind: "error"; error: unknown };

export type AccountBootstrapDeps = {
  getAccount: () => Promise<AccountResponse>;
  initializeAccount: () => Promise<AccountResponse>;
};

const defaultDeps: AccountBootstrapDeps = {
  getAccount,
  initializeAccount,
};

let inFlight: Promise<BootstrapResult> | null = null;

export async function loadPaperAccount(
  getAccountFn: () => Promise<AccountResponse> = getAccount,
): Promise<BootstrapResult> {
  try {
    const account = await getAccountFn();
    return { kind: "ready", account, initialized: false };
  } catch (error) {
    if (isUnauthorized(error)) {
      return { kind: "unauthorized" };
    }

    if (isAccountNotInitialized(error)) {
      return { kind: "uninitialized" };
    }

    return { kind: "error", error };
  }
}

export async function runAccountBootstrap(
  deps: AccountBootstrapDeps = defaultDeps,
): Promise<BootstrapResult> {
  if (inFlight) {
    return inFlight;
  }

  inFlight = executeBootstrap(deps).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function resetAccountBootstrapLock(): void {
  inFlight = null;
}

async function executeBootstrap(deps: AccountBootstrapDeps): Promise<BootstrapResult> {
  const loaded = await loadPaperAccount(deps.getAccount);

  if (loaded.kind !== "uninitialized") {
    return loaded;
  }

  try {
    const account = await deps.initializeAccount();
    return { kind: "ready", account, initialized: true };
  } catch (error) {
    if (isUnauthorized(error)) {
      return { kind: "unauthorized" };
    }

    return { kind: "error", error };
  }
}
