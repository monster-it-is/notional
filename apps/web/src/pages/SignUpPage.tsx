import type { FormEvent } from "react";
import { useId, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { getSafeInternalPath } from "../auth/internal-path.ts";
import { PasswordInput } from "../components/auth/PasswordInput.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ErrorBanner } from "../components/ui/ErrorBanner.tsx";
import { FormField } from "../components/ui/FormField.tsx";
import { Input } from "../components/ui/Input.tsx";

export function SignUpPage() {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const passwordHintId = useId();
  const confirmId = useId();
  const mismatchId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const safeFrom = getSafeInternalPath(params.get("from"));
  const signinHref = safeFrom ? `/signin?from=${encodeURIComponent(safeFrom)}` : "/signin";

  if (session.isPending) {
    return <p className="text-sm text-secondary">Loading session…</p>;
  }

  if (session.data) {
    return <Navigate to="/trade" replace />;
  }

  function onPasswordChange(value: string): void {
    setPassword(value);
    setMismatch((current) => (current ? value !== confirmPassword : false));
  }

  function onConfirmPasswordChange(value: string): void {
    setConfirmPassword(value);
    setMismatch((current) => (current ? password !== value : false));
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setMismatch(true);
      return;
    }

    setMismatch(false);
    setPending(true);
    try {
      const result = await authClient.signUp.email({ name, email, password });
      if (result.error) {
        setError(new Error(result.error.message ?? "Sign up failed"));
        return;
      }

      navigate("/trade", { replace: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending || undefined} className="space-y-4" onSubmit={onSubmit}>
      <p className="font-numeric text-[11px] uppercase tracking-[0.16em] text-secondary">
        <span className="text-accent">01</span>
        <span className="mx-2 text-border-strong">/</span>
        Account
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl">Create a paper account</h1>
        <p className="text-sm text-secondary">
          Opens a simulated session. The desk then credits 1,000 virtual USDT. No real assets are
          traded.
        </p>
      </div>
      {error ? <ErrorBanner error={error} /> : null}
      <FormField label="Name">
        <Input
          autoComplete="name"
          disabled={pending}
          id={nameId}
          name="name"
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </FormField>
      <FormField label="Email">
        <Input
          autoCapitalize="none"
          autoComplete="email"
          disabled={pending}
          id={emailId}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          spellCheck={false}
          type="email"
          value={email}
        />
      </FormField>
      <div>
        <FormField htmlFor={passwordId} label="Password">
          <PasswordInput
            aria-describedby={passwordHintId}
            autoComplete="new-password"
            disabled={pending}
            id={passwordId}
            minLength={8}
            name="password"
            onChange={(event) => onPasswordChange(event.target.value)}
            required
            value={password}
          />
        </FormField>
        <p className="mt-1 text-xs text-secondary" id={passwordHintId}>
          At least 8 characters.
        </p>
      </div>
      <div>
        <FormField htmlFor={confirmId} label="Confirm password">
          <PasswordInput
            aria-describedby={mismatch ? mismatchId : undefined}
            autoComplete="new-password"
            disabled={pending}
            id={confirmId}
            invalid={mismatch}
            minLength={8}
            name="confirmPassword"
            onChange={(event) => onConfirmPasswordChange(event.target.value)}
            required
            value={confirmPassword}
          />
        </FormField>
        {mismatch ? (
          <p
            className="mt-1.5 border border-warning-border bg-warning-background px-2 py-1.5 text-xs text-warning"
            id={mismatchId}
            role="alert"
          >
            Passwords do not match.
          </p>
        ) : null}
      </div>
      <Button className="w-full" disabled={pending} size="lg" type="submit" variant="primary">
        {pending ? "Creating account…" : "Create paper account"}
      </Button>
      <p className="text-sm text-secondary">
        Already have an account?{" "}
        <Link className="text-foreground hover:text-foreground" to={signinHref}>
          Log in
        </Link>
      </p>
    </form>
  );
}
