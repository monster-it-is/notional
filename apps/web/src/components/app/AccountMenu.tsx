import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { authClient } from "../../auth/auth-client.ts";
import { cn } from "../../lib/cn.ts";
import { stopRealtime } from "../../realtime/runtime.ts";

const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function AccountMenu() {
  const session = authClient.useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const user = session.data?.user;
  const identity =
    user?.name && user.name.trim().length > 0 ? user.name : (user?.email ?? "Account");

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    }

    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  async function signOut(): Promise<void> {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    try {
      stopRealtime();
      await authClient.signOut();
      queryClient.clear();
      navigate("/signin", { replace: true });
    } catch {
      return;
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        aria-controls={popoverId}
        aria-expanded={open}
        aria-label={identity}
        className={cn(
          "inline-flex h-10 min-w-0 max-w-24 items-center px-2 text-sm text-secondary hover:text-foreground md:max-w-40",
          focus,
        )}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <span className="block truncate">{identity}</span>
      </button>
      {open ? (
        <div
          className="absolute right-0 z-40 mt-1 min-w-44 border border-border bg-surface p-1"
          id={popoverId}
        >
          <Link
            className={cn(
              "app-chrome-link flex min-h-11 items-center px-2.5 text-sm",
              focus,
            )}
            onClick={() => setOpen(false)}
            to="/account"
          >
            Account
          </Link>
          <button
            className={cn(
              "flex min-h-11 w-full items-center px-2.5 text-left text-sm text-foreground hover:bg-surface-subtle",
              focus,
            )}
            disabled={signingOut}
            onClick={() => void signOut()}
            type="button"
          >
            {signingOut ? "Signing out…" : "Log out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
