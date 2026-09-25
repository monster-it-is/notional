import { NavLink } from "react-router";

import { cn } from "../../lib/cn.ts";
import { APP_NAV } from "./app-nav.ts";

const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function AppBottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex">
        {APP_NAV.map((item) => (
          <NavLink
            className={({ isActive }) =>
              cn(
                "app-chrome-link inline-flex min-h-11 min-w-0 flex-1 items-center justify-center px-2 text-sm",
                focus,
                isActive && "shadow-[inset_0_2px_0_0_var(--accent)]",
              )
            }
            key={item.to}
            to={item.to}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
