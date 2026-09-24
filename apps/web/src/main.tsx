import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
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
