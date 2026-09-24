import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "./ThemeProvider.tsx";
import { THEME_STORAGE_KEY } from "./theme.ts";

function Probe() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={() => setTheme("light")}>
        Use light
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        Use dark
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("applies a saved preference to html on mount", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("persists a user change and updates the html class", async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(document.documentElement).toHaveClass("dark");
    await user.click(screen.getByRole("button", { name: "Use light" }));
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement).toHaveClass("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("still applies the in-page theme when persistence throws", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    try {
      await user.click(screen.getByRole("button", { name: "Use light" }));
      expect(screen.getByTestId("theme")).toHaveTextContent("light");
      expect(document.documentElement).toHaveClass("light");
    } finally {
      setItem.mockRestore();
    }
  });
});
