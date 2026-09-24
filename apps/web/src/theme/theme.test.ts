import { afterEach, describe, expect, it } from "vitest";

import {
  applyTheme,
  getSystemTheme,
  initTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "./theme.ts";

afterEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

describe("theme resolution", () => {
  it("uses a saved dark preference over the OS", () => {
    persistTheme("dark");
    expect(readStoredTheme()).toBe("dark");
    expect(resolveTheme(readStoredTheme(), "light")).toBe("dark");
  });

  it("uses a saved light preference over the OS", () => {
    persistTheme("light");
    expect(readStoredTheme()).toBe("light");
    expect(resolveTheme(readStoredTheme(), "dark")).toBe("light");
  });

  it("falls back to OS dark when nothing is stored", () => {
    expect(readStoredTheme()).toBeNull();
    expect(resolveTheme(null, getSystemTheme({ matches: true }))).toBe("dark");
  });

  it("falls back to OS light when nothing is stored", () => {
    expect(resolveTheme(null, getSystemTheme({ matches: false }))).toBe("light");
  });

  it("treats invalid stored values as missing", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readStoredTheme()).toBeNull();
    expect(resolveTheme(readStoredTheme(), "dark")).toBe("dark");
  });

  it("defaults to dark when system preference is unavailable", () => {
    expect(getSystemTheme(null)).toBe("dark");
  });
});

describe("theme application", () => {
  it("applies the semantic html class, data attribute, and color-scheme", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists a user choice and initTheme restores it", () => {
    persistTheme("light");
    const theme = initTheme();
    expect(theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("does not throw when storage cannot persist", () => {
    const storage = {
      setItem(): void {
        throw new Error("quota exceeded");
      },
    };

    expect(() => persistTheme("light", storage)).not.toThrow();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
