export const THEME_STORAGE_KEY = "notional.theme";

export type Theme = "light" | "dark";

export function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark";
}

export function getSystemTheme(
  media: Pick<MediaQueryList, "matches"> | null = typeof window === "undefined"
    ? null
    : (window.matchMedia?.("(prefers-color-scheme: dark)") ?? null),
): Theme {
  if (!media) {
    return "dark";
  }

  return media.matches ? "dark" : "light";
}

export function readStoredTheme(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
): Theme | null {
  if (!storage) {
    return null;
  }

  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function resolveTheme(stored: Theme | null, system: Theme): Theme {
  return stored ?? system;
}

export function applyTheme(
  theme: Theme,
  root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement,
): void {
  if (!root) {
    return;
  }

  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  root.dataset.theme = theme;
}

export function persistTheme(
  theme: Theme,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persistence cannot survive reload when storage is unavailable.
  }
}

export function initTheme(): Theme {
  const theme = resolveTheme(readStoredTheme(), getSystemTheme());
  applyTheme(theme);
  return theme;
}
