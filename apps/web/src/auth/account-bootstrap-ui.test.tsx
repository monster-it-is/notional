import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountBootstrap } from "../layouts/AccountBootstrap.tsx";

const { acquire, runAccountBootstrap, useSession } = vi.hoisted(() => ({
  acquire: vi.fn(),
  runAccountBootstrap: vi.fn(),
  useSession: vi.fn(() => ({
    data: { user: { email: "ada@example.com", name: "Ada" } },
    isPending: false,
  })),
}));

vi.mock("../auth/auth-client.ts", () => ({
  authClient: {
    useSession: () => useSession(),
  },
}));

vi.mock("../auth/account-bootstrap.ts", () => ({
  runAccountBootstrap: () => runAccountBootstrap(),
}));

vi.mock("../hooks/use-account-socket.ts", () => ({
  useAccountSocket: (ready: boolean) => {
    if (ready) {
      acquire();
    }
  },
}));

function renderBootstrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccountBootstrap>{children}</AccountBootstrap>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AccountBootstrap UI", () => {
  beforeEach(() => {
    acquire.mockReset();
    runAccountBootstrap.mockReset();
  });

  it("does not acquire the account socket until READY and hides children", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    runAccountBootstrap.mockReturnValue(
      new Promise((next) => {
        resolve = next;
      }),
    );

    renderBootstrap(<div>secret-trading</div>);

    expect(screen.getByText(/Preparing paper account/)).toBeInTheDocument();
    expect(screen.queryByText("secret-trading")).not.toBeInTheDocument();
    expect(acquire).not.toHaveBeenCalled();

    resolve?.({
      kind: "ready",
      initialized: false,
      account: {
        id: "a",
        userId: "u",
        currency: "USDT",
        balance: "1000",
        status: "ACTIVE",
        lastFaucetClaimAt: null,
        createdAt: "t",
      },
    });

    await waitFor(() => expect(screen.getByText("secret-trading")).toBeInTheDocument());
    expect(acquire).toHaveBeenCalled();
  });

  it("shows a blocking retry on initialize failure", async () => {
    runAccountBootstrap.mockResolvedValue({
      kind: "error",
      error: new Error("init failed"),
    });

    renderBootstrap(<div>secret-trading</div>);

    expect(await screen.findByText("Paper account unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("secret-trading")).not.toBeInTheDocument();
    expect(acquire).not.toHaveBeenCalled();
  });
});
