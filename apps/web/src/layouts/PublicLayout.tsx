import { Outlet } from "react-router";

export function PublicLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <Outlet />
    </div>
  );
}
