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

export function SignInPage() {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const from = params.get("from");
  const safeFrom = getSafeInternalPath(from);
  const target = safeFrom ?? "/trade";
  const signupHref = safeFrom ? `/signup?from=${encodeURIComponent(safeFrom)}` : "/signup";

  if (session.isPending) {
    return <p className="text-sm text-secondary">Loading session…</p>;
  }

  if (session.data) {
    return <Navigate to={target} replace />;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(new Error(result.error.message ?? "Sign in failed"));
        return;
      }

      navigate(target, { replace: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending || undefined} className="space-y-4" onSubmit={onSubmit}>
      <p className="font-numeric text-[11px] uppercase tracking-[0.16em] text-secondary">
        <span className="text-accent">01</span>
        <span className="mx-2 text-border-strong">/</span>
        Session
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl">Log in</h1>
        <p className="text-sm text-secondary">Continue to the paper trading desk.</p>
      </div>
      {error ? <ErrorBanner error={error} /> : null}
      <FormField label="Email">
        <Input
          autoCapitalize="none"
          autoComplete="username"
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
      <FormField htmlFor={passwordId} label="Password">
        <PasswordInput
          autoComplete="current-password"
          disabled={pending}
          id={passwordId}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          value={password}
        />
      </FormField>
      <Button className="w-full" disabled={pending} size="lg" type="submit" variant="primary">
        {pending ? "Signing in…" : "Log in"}
      </Button>
      <p className="text-sm text-secondary">
        No paper account?{" "}
        <Link className="text-foreground hover:text-foreground" to={signupHref}>
          Create one
        </Link>
      </p>
    </form>
  );
}
