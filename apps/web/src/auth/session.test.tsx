import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "../layouts/ProtectedRoute.tsx";

const useSession = vi.fn();

vi.mock("../auth/auth-client.ts", () => ({
  authClient: {
    useSession: () => useSession(),
  },
}));

describe("ProtectedRoute", () => {
  beforeEach(() => {
    useSession.mockReset();
  });

  it("uses Better Auth session only and redirects when unsigned", () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    render(
      <MemoryRouter initialEntries={["/trade"]}>
        <Routes>
          <Route path="/signin" element={<div>signin</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/trade" element={<div>trade</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("signin")).toBeInTheDocument();
    expect(screen.queryByText("trade")).not.toBeInTheDocument();
  });

  it("renders the protected outlet when a session exists", () => {
    useSession.mockReturnValue({
      data: { user: { id: "1", email: "ada@example.com", name: "Ada" } },
      isPending: false,
    });
    render(
      <MemoryRouter initialEntries={["/trade"]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/trade" element={<div>trade</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("trade")).toBeInTheDocument();
  });
});
