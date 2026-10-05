import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

import { TRADE_CHART_PREFERENCES_KEY } from "../lib/chart/preferences.ts";
import { THEME_STORAGE_KEY } from "../theme/theme.ts";

afterEach(() => {
  cleanup();
  localStorage.removeItem(THEME_STORAGE_KEY);
  localStorage.removeItem(TRADE_CHART_PREFERENCES_KEY);
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});
