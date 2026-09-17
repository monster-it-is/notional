import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createRoot, render } = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  createRoot: (container: Element) => {
    createRoot(container);
    return { render };
  },
}));

vi.mock("./app/providers.tsx", () => ({
  AppProviders: () => null,
}));

describe("web bootstrap", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    createRoot.mockClear();
    render.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
  });

  it("renders the static fatal UI and does not mount when the API URL is invalid", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/secret-path");
    await import("./main.tsx");

    expect(createRoot).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    const root = document.getElementById("root");
    expect(root).not.toBeNull();
    expect(root?.innerHTML).toBe(
      "<main><h1>Configuration error</h1><p>This app is missing a valid API URL and cannot start.</p></main>",
    );
    expect(root?.textContent).toContain("Configuration error");
    expect(root?.innerHTML).not.toContain("VITE_API_BASE_URL");
    expect(root?.innerHTML).not.toContain("WebConfigError");
    expect(root?.innerHTML).not.toContain("must not include a path");
    expect(root?.innerHTML).not.toContain("secret-path");
    expect(root?.innerHTML).not.toContain("https://api.example.com");
    expect(root?.innerHTML).not.toMatch(/at\s+\S+/);
  });

  it("mounts the React app and does not render the fatal UI when the API URL is valid", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:3000");
    await import("./main.tsx");

    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(document.getElementById("root")?.innerHTML).not.toContain("Configuration error");
  });
});
