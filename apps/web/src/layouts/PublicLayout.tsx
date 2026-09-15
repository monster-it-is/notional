import { Outlet } from "react-router";

import { Header } from "../components/Header.tsx";

export function PublicLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <Header signedIn={false} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
