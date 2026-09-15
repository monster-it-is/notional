import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api/errors.ts";
import { resetAccountBootstrapLock, runAccountBootstrap } from "./account-bootstrap.ts";
import { queryKeys } from "../lib/query-keys.ts";

describe("account bootstrap", () => {
  beforeEach(() => {
    resetAccountBootstrapLock();
  });

  it("is READY on account 200 without initialize", async () => {
    const initializeAccount = vi.fn(async () => {
      throw new Error("unused");
    });
    const result = await runAccountBootstrap({
      getAccount: async () => ({
        id: "a",
        userId: "u",
        currency: "USDT",
        balance: "1000",
        status: "ACTIVE",
        lastFaucetClaimAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      initializeAccount,
    });

    expect(result.kind).toBe("ready");
    expect(result.kind === "ready" && result.initialized).toBe(false);
    expect(initializeAccount).not.toHaveBeenCalled();
  });

  it("initializes once on 409 then READY", async () => {
    const initializeAccount = vi.fn(async () => ({
      id: "a",
      userId: "u",
      currency: "USDT" as const,
      balance: "1000",
      status: "ACTIVE" as const,
      lastFaucetClaimAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));

    const result = await runAccountBootstrap({
      getAccount: async () => {
        throw new ApiError({ status: 409, code: "ACCOUNT_NOT_INITIALIZED" });
      },
      initializeAccount,
    });

    expect(result.kind).toBe("ready");
    expect(result.kind === "ready" && result.initialized).toBe(true);
    expect(initializeAccount).toHaveBeenCalledTimes(1);
  });

  it("shares an in-flight bootstrap so initialize is not doubled", async () => {
    const account = {
      id: "a",
      userId: "u",
      currency: "USDT" as const,
      balance: "1000",
      status: "ACTIVE" as const,
      lastFaucetClaimAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    let resolveInit: ((value: typeof account) => void) | undefined;
    const initializeAccount = vi.fn(
      () =>
        new Promise<typeof account>((resolve) => {
          resolveInit = resolve;
        }),
    );

    const deps = {
      getAccount: async () => {
        throw new ApiError({ status: 409, code: "ACCOUNT_NOT_INITIALIZED" });
      },
      initializeAccount,
    };

    const first = runAccountBootstrap(deps);
    const second = runAccountBootstrap(deps);
    await vi.waitFor(() => expect(initializeAccount).toHaveBeenCalledTimes(1));
    resolveInit?.(account);
    await Promise.all([first, second]);
    expect(initializeAccount).toHaveBeenCalledTimes(1);
  });

  it("returns error on initialize failure so retry can GET first", async () => {
    const result = await runAccountBootstrap({
      getAccount: async () => {
        throw new ApiError({ status: 409, code: "ACCOUNT_NOT_INITIALIZED" });
      },
      initializeAccount: async () => {
        throw new ApiError({ status: 500, code: "REQUEST_FAILED" });
      },
    });

    expect(result.kind).toBe("error");
  });

  it("retries GET first and initializes only if still 409", async () => {
    const account = {
      id: "a",
      userId: "u",
      currency: "USDT" as const,
      balance: "1000",
      status: "ACTIVE" as const,
      lastFaucetClaimAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const getAccount = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 409, code: "ACCOUNT_NOT_INITIALIZED" }))
      .mockResolvedValueOnce(account);
    const initializeAccount = vi.fn(async () => {
      throw new ApiError({ status: 500, code: "REQUEST_FAILED" });
    });

    const first = await runAccountBootstrap({ getAccount, initializeAccount });
    expect(first.kind).toBe("error");
    expect(initializeAccount).toHaveBeenCalledTimes(1);

    const second = await runAccountBootstrap({ getAccount, initializeAccount });
    expect(second.kind).toBe("ready");
    expect(initializeAccount).toHaveBeenCalledTimes(1);
    expect(getAccount).toHaveBeenCalledTimes(2);
  });

  it("does not define a /api/me query key", () => {
    expect("me" in queryKeys).toBe(false);
  });
});
