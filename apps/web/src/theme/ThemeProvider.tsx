import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  applyTheme,
  getSystemTheme,
  initTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from "./theme.ts";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => initTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    function onStorage(event: StorageEvent): void {
      if (event.key !== THEME_STORAGE_KEY) {
        return;
      }

      setThemeState(resolveTheme(readStoredTheme(), getSystemTheme()));
    }

    function onSystemChange(event: MediaQueryListEvent): void {
      if (readStoredTheme()) {
        return;
      }

      setThemeState(event.matches ? "dark" : "light");
    }

    window.addEventListener("storage", onStorage);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", onSystemChange);

    return () => {
      window.removeEventListener("storage", onStorage);
      media?.removeEventListener("change", onSystemChange);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    persistTheme(next);
    applyTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return value;
}
