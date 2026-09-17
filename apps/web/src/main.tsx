import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProviders } from "./app/providers.tsx";
import "./index.css";
import { WebConfigError, apiBaseUrl } from "./lib/env.ts";

function renderFatalConfig(): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  root.innerHTML =
    "<main><h1>Configuration error</h1><p>This app is missing a valid API URL and cannot start.</p></main>";
}

try {
  apiBaseUrl();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProviders />
    </StrictMode>,
  );
} catch (error) {
  if (error instanceof WebConfigError) {
    renderFatalConfig();
  } else {
    throw error;
  }
}
