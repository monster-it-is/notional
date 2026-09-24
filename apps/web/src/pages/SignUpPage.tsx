import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { Button } from "../components/ui/Button.tsx";
import { ErrorBanner } from "../components/ui/ErrorBanner.tsx";
import { FormField } from "../components/ui/FormField.tsx";
import { Input } from "../components/ui/Input.tsx";

export function SignUpPage() {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
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
    const result = await authClient.signUp.email({ name, email, password });
    setPending(false);

    if (result.error) {
      setError(new Error(result.error.message ?? "Sign up failed"));
      return;
    }

    navigate("/trade", { replace: true });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <h1 className="text-2xl">Sign up</h1>
      <p className="text-sm text-secondary">
        After sign up, Notional creates your paper account (1,000 USDT signup allocation) in the
        authenticated app. This form only creates the user session.
      </p>
      {error ? <ErrorBanner error={error} /> : null}
      <FormField label="Name">
        <Input value={name} onChange={(event) => setName(event.target.value)} required />
      </FormField>
      <FormField label="Email">
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </FormField>
      <FormField label="Password">
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Creating session…" : "Sign up"}
      </Button>
      <p className="text-sm text-secondary">
        Already registered? <Link to="/signin">Sign in</Link>
      </p>
    </form>
  );
}
