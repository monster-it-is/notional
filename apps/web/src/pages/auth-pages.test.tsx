import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthLayout } from "../layouts/AuthLayout.tsx";
import { SignInPage } from "./SignInPage.tsx";
import { SignUpPage } from "./SignUpPage.tsx";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { THEME_STORAGE_KEY } from "../theme/theme.ts";

const { signInEmail, signUpEmail, useSession } = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("../auth/auth-client.ts", () => ({
  authClient: {
    useSession: () => useSession(),
    signIn: { email: (...args: unknown[]) => signInEmail(...args) },
    signUp: { email: (...args: unknown[]) => signUpEmail(...args) },
  },
}));

function renderAuth(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/signup" element={<SignUpPage />} />
          </Route>
          <Route path="/trade" element={<div>trade desk</div>} />
          <Route path="/history" element={<div>history page</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

function unsignedSession() {
  useSession.mockReturnValue({ data: null, isPending: false });
}

describe("auth pages", () => {
  beforeEach(() => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    useSession.mockReset();
    signInEmail.mockReset();
    signUpEmail.mockReset();
    unsignedSession();
  });

  describe("sign in", () => {
    it("exposes only email and password with password-manager attributes", () => {
      renderAuth("/signin");

      expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
      expect(screen.getByText("Continue to the paper trading desk.")).toBeInTheDocument();

      const email = screen.getByLabelText("Email");
      expect(email).toHaveAttribute("name", "email");
      expect(email).toHaveAttribute("type", "email");
      expect(email).toHaveAttribute("autocomplete", "username");
      expect(email).toHaveAttribute("autocapitalize", "none");

      const password = screen.getByLabelText("Password");
      expect(password).toHaveAttribute("name", "password");
      expect(password).toHaveAttribute("type", "password");
      expect(password).toHaveAttribute("autocomplete", "current-password");
      expect(password).not.toHaveAttribute("minLength");

      expect(screen.getAllByRole("textbox")).toHaveLength(1);
      expect(screen.queryByText(/forgot password/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/remember me/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /google|github|continue with/i })).not.toBeInTheDocument();
    });

    it("does not flash the form while the session is pending", () => {
      useSession.mockReturnValue({ data: null, isPending: true });
      renderAuth("/signin");

      expect(screen.getByText("Loading session…")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Log in" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    });

    it("redirects an already-authenticated visitor to a validated from path", () => {
      useSession.mockReturnValue({
        data: { user: { id: "1", email: "ada@example.com", name: "Ada" } },
        isPending: false,
      });
      renderAuth("/signin?from=%2Fhistory");

      expect(screen.getByText("history page")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Log in" })).not.toBeInTheDocument();
    });

    it("falls back to /trade for external and protocol-relative from values", () => {
      useSession.mockReturnValue({
        data: { user: { id: "1", email: "ada@example.com", name: "Ada" } },
        isPending: false,
      });

      const { unmount } = renderAuth("/signin?from=https%3A%2F%2Fexample.com");
      expect(screen.getByText("trade desk")).toBeInTheDocument();
      unmount();

      renderAuth(`/signin?from=${encodeURIComponent("//example.com")}`);
      expect(screen.getByText("trade desk")).toBeInTheDocument();
    });

    it("falls back to /trade when from is missing", () => {
      useSession.mockReturnValue({
        data: { user: { id: "1", email: "ada@example.com", name: "Ada" } },
        isPending: false,
      });
      renderAuth("/signin");

      expect(screen.getByText("trade desk")).toBeInTheDocument();
    });

    it("navigates to a validated from path after successful authentication", async () => {
      const user = userEvent.setup();
      signInEmail.mockResolvedValue({ error: null });
      renderAuth("/signin?from=%2Fhistory");

      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.type(screen.getByLabelText("Password"), "password1");
      await user.click(screen.getByRole("button", { name: "Log in" }));

      expect(signInEmail).toHaveBeenCalledWith({ email: "ada@example.com", password: "password1" });
      expect(screen.getByText("history page")).toBeInTheDocument();
    });

    it("rejects an unsafe from value after successful authentication", async () => {
      const user = userEvent.setup();
      signInEmail.mockResolvedValue({ error: null });
      renderAuth(`/signin?from=${encodeURIComponent("//example.com")}`);

      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.type(screen.getByLabelText("Password"), "password1");
      await user.click(screen.getByRole("button", { name: "Log in" }));

      expect(screen.getByText("trade desk")).toBeInTheDocument();
    });

    it("disables all form controls while submission is pending", async () => {
      const user = userEvent.setup();
      signInEmail.mockReturnValue(new Promise(() => undefined));
      renderAuth("/signin");

      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.type(screen.getByLabelText("Password"), "password1");
      fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

      expect(screen.getByLabelText("Email")).toBeDisabled();
      expect(screen.getByLabelText("Password")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Show password" })).toBeDisabled();
      expect(screen.getByLabelText("Email").closest("form")).toHaveAttribute("aria-busy", "true");
      expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
    });

    it("toggles password visibility without changing the sign-in request", async () => {
      const user = userEvent.setup();
      signInEmail.mockResolvedValue({ error: null });
      renderAuth("/signin");

      const password = screen.getByLabelText("Password");
      expect(password).toHaveAttribute("type", "password");

      const show = screen.getByRole("button", { name: "Show password" });
      expect(show).toHaveAttribute("type", "button");
      expect(show).toHaveAttribute("aria-pressed", "false");

      await user.click(show);
      expect(password).toHaveAttribute("type", "text");
      const hide = screen.getByRole("button", { name: "Hide password" });
      expect(hide).toHaveAttribute("aria-pressed", "true");

      await user.click(hide);
      expect(password).toHaveAttribute("type", "password");
      expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");

      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.type(password, "password1");
      await user.click(screen.getByRole("button", { name: "Log in" }));

      expect(signInEmail).toHaveBeenCalledTimes(1);
      expect(signInEmail).toHaveBeenCalledWith({ email: "ada@example.com", password: "password1" });
    });

    it("preserves only a validated from on the sign-up cross-link", () => {
      const { unmount } = renderAuth("/signin?from=%2Fhistory");
      expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute(
        "href",
        "/signup?from=%2Fhistory",
      );
      unmount();

      renderAuth(`/signin?from=${encodeURIComponent("//example.com")}`);
      expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute("href", "/signup");
    });
  });

  describe("sign up", () => {
    it("exposes name, email, password, and confirm password with password-manager attributes", () => {
      renderAuth("/signup");

      expect(screen.getByRole("heading", { level: 1, name: "Create a paper account" })).toBeInTheDocument();
      expect(screen.queryByText(/this form only creates the user session/i)).not.toBeInTheDocument();

      const name = screen.getByLabelText("Name");
      expect(name).toHaveAttribute("name", "name");
      expect(name).toHaveAttribute("autocomplete", "name");

      const email = screen.getByLabelText("Email");
      expect(email).toHaveAttribute("name", "email");
      expect(email).toHaveAttribute("type", "email");
      expect(email).toHaveAttribute("autocomplete", "email");

      const password = screen.getByLabelText("Password");
      expect(password).toHaveAttribute("name", "password");
      expect(password).toHaveAttribute("type", "password");
      expect(password).toHaveAttribute("autocomplete", "new-password");
      expect(password).toHaveAttribute("minLength", "8");
      expect(password).toHaveAccessibleName("Password");
      expect(password).toHaveAccessibleDescription("At least 8 characters.");
      expect(password.getAttribute("aria-describedby")).toBeTruthy();
      expect(
        document.getElementById(password.getAttribute("aria-describedby")!),
      ).toHaveTextContent("At least 8 characters.");

      const confirm = screen.getByLabelText("Confirm password");
      expect(confirm).toHaveAttribute("name", "confirmPassword");
      expect(confirm).toHaveAttribute("type", "password");
      expect(confirm).toHaveAttribute("autocomplete", "new-password");
      expect(confirm).toHaveAttribute("minLength", "8");
      expect(confirm).toBeRequired();
      expect(confirm).not.toHaveAttribute("aria-invalid");
      expect(screen.getAllByRole("button", { name: "Show password" })).toHaveLength(2);

      expect(screen.getAllByRole("textbox")).toHaveLength(2);
      expect(screen.queryByText(/forgot password/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/remember me/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /google|github|continue with/i })).not.toBeInTheDocument();
    });

    it("toggles each password field independently", async () => {
      const user = userEvent.setup();
      renderAuth("/signup");

      const password = screen.getByLabelText("Password");
      const confirm = screen.getByLabelText("Confirm password");
      const [showPassword, showConfirm] = screen.getAllByRole("button", { name: "Show password" });

      await user.click(showPassword!);
      expect(password).toHaveAttribute("type", "text");
      expect(confirm).toHaveAttribute("type", "password");
      expect(showPassword).toHaveAccessibleName("Hide password");
      expect(showPassword).toHaveAttribute("aria-pressed", "true");
      expect(showConfirm).toHaveAttribute("aria-pressed", "false");

      await user.click(showConfirm!);
      expect(password).toHaveAttribute("type", "text");
      expect(confirm).toHaveAttribute("type", "text");

      await user.click(showPassword!);
      expect(password).toHaveAttribute("type", "password");
      expect(confirm).toHaveAttribute("type", "text");
    });

    it("does not flash the form while the session is pending", () => {
      useSession.mockReturnValue({ data: null, isPending: true });
      renderAuth("/signup");

      expect(screen.getByText("Loading session…")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Create a paper account" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    });

    it("disables all form controls while submission is pending", async () => {
      const user = userEvent.setup();
      signUpEmail.mockReturnValue(new Promise(() => undefined));
      renderAuth("/signup");

      await user.type(screen.getByLabelText("Name"), "Ada");
      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.type(screen.getByLabelText("Password"), "password1");
      await user.type(screen.getByLabelText("Confirm password"), "password1");
      fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

      expect(screen.getByLabelText("Name")).toBeDisabled();
      expect(screen.getByLabelText("Email")).toBeDisabled();
      expect(screen.getByLabelText("Password")).toBeDisabled();
      expect(screen.getByLabelText("Confirm password")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled();
      for (const toggle of screen.getAllByRole("button", { name: "Show password" })) {
        expect(toggle).toBeDisabled();
      }
      expect(screen.getByLabelText("Email").closest("form")).toHaveAttribute("aria-busy", "true");
    });

    it("always navigates to /trade after successful signup", async () => {
      const user = userEvent.setup();
      signUpEmail.mockResolvedValue({ error: null });
      renderAuth("/signup?from=%2Fhistory");

      await user.type(screen.getByLabelText("Name"), "Ada");
      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.type(screen.getByLabelText("Password"), "password1");
      await user.type(screen.getByLabelText("Confirm password"), "password1");
      await user.click(screen.getByRole("button", { name: "Create paper account" }));

      expect(signUpEmail).toHaveBeenCalledTimes(1);
      expect(signUpEmail).toHaveBeenCalledWith({
        name: "Ada",
        email: "ada@example.com",
        password: "password1",
      });
      expect(signUpEmail.mock.calls[0]?.[0]).not.toHaveProperty("confirmPassword");
      expect(screen.getByText("trade desk")).toBeInTheDocument();
      expect(screen.queryByText("history page")).not.toBeInTheDocument();
    });

    it("blocks signup and shows a field error when passwords do not match", async () => {
      const user = userEvent.setup();
      renderAuth("/signup");

      await user.type(screen.getByLabelText("Name"), "Ada");
      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.type(screen.getByLabelText("Password"), "password123");
      await user.type(screen.getByLabelText("Confirm password"), "somethingElse");
      await user.click(screen.getByRole("button", { name: "Create paper account" }));

      const confirm = screen.getByLabelText("Confirm password");
      const message = screen.getByText("Passwords do not match.");
      expect(confirm).toHaveAttribute("aria-invalid", "true");
      expect(confirm.getAttribute("aria-describedby")).toBe(message.id);
      expect(message.className).not.toMatch(/negative|text-red/);
      expect(signUpEmail).not.toHaveBeenCalled();

      await user.clear(confirm);
      await user.type(confirm, "password123");
      expect(screen.queryByText("Passwords do not match.")).not.toBeInTheDocument();
      expect(confirm).not.toHaveAttribute("aria-invalid");
    });

    it("preserves only a validated from on the log-in cross-link", () => {
      const { unmount } = renderAuth("/signup?from=%2Fhistory");
      expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
        "href",
        "/signin?from=%2Fhistory",
      );
      unmount();

      renderAuth(`/signup?from=${encodeURIComponent("//example.com")}`);
      expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/signin");
    });
  });
});
