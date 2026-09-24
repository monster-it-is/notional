import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { Button } from "../components/ui/Button.tsx";
import { ErrorBanner } from "../components/ui/ErrorBanner.tsx";
import { FormField } from "../components/ui/FormField.tsx";
import { Input } from "../components/ui/Input.tsx";

export function SignInPage() {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  if (session.data) {
    return <Navigate to="/trade" replace />;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.signIn.email({ email, password });
    setPending(false);

    if (result.error) {
      setError(new Error(result.error.message ?? "Sign in failed"));
      return;
    }

    const from = params.get("from");
    navigate(from && from.startsWith("/") ? from : "/trade", { replace: true });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <h1 className="text-2xl">Sign in</h1>
      {error ? <ErrorBanner error={error} /> : null}
      <FormField label="Email">
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </FormField>
      <FormField label="Password">
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-sm text-secondary">
        No account? <Link to="/signup">Sign up</Link>
      </p>
    </form>
  );
}
