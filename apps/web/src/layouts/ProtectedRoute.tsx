import { Navigate, Outlet, useLocation } from "react-router";

import { authClient } from "../auth/auth-client.ts";

export function ProtectedRoute() {
  const session = authClient.useSession();
  const location = useLocation();

  if (session.isPending) {
    return <p className="p-6 text-sm text-secondary">Loading session…</p>;
  }

  if (!session.data) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to={`/signin?from=${encodeURIComponent(from)}`} replace />;
  }

  return <Outlet />;
}
