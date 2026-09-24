import { isDecimalGte } from "@notional/trading";
import { useEffect, useState } from "react";

export type TickFlash = "up" | "down" | null;

const FLASH_MS = 420;

export function useTickFlash(value: string | undefined, live = false): TickFlash {
  const [snapshot, setSnapshot] = useState<{ value: string | undefined; flash: TickFlash }>({
    value,
    flash: null,
  });

  if (value !== snapshot.value) {
    setSnapshot({
      value,
      flash: live ? compareTick(snapshot.value, value) : null,
    });
  }

  useEffect(() => {
    if (!snapshot.flash) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSnapshot((current) => (current.flash ? { value: current.value, flash: null } : current));
    }, FLASH_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [snapshot.flash, snapshot.value]);

  return live ? snapshot.flash : null;
}

function compareTick(previous: string | undefined, next: string | undefined): TickFlash {
  if (!previous || !next || previous === next || prefersReducedMotion()) {
    return null;
  }

  try {
    return isDecimalGte(next, previous) ? "up" : "down";
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}
