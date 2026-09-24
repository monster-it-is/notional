import { Outlet, useLocation } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { Header } from "../components/Header.tsx";

export function PublicLayout() {
  const { pathname } = useLocation();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data);

  if (pathname === "/") {
    return (
      <div className="flex min-h-svh flex-col bg-background">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <Header signedIn={signedIn} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
