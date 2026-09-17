import { afterEach, describe, expect, it, vi } from "vitest";

import { WebConfigError, apiBaseUrl, wsBaseUrl } from "./env.ts";

describe("web env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing and empty values", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    expect(() => apiBaseUrl()).toThrow(WebConfigError);

    vi.stubEnv("VITE_API_BASE_URL", undefined as unknown as string);
    expect(() => apiBaseUrl()).toThrow(WebConfigError);
  });

  it("rejects a relative URL", () => {
    vi.stubEnv("VITE_API_BASE_URL", "/api");
    expect(() => apiBaseUrl()).toThrow(WebConfigError);
  });

  it("rejects ftp:", () => {
    vi.stubEnv("VITE_API_BASE_URL", "ftp://api.example.com");
    expect(() => apiBaseUrl()).toThrow(WebConfigError);
  });

  it("normalizes a root trailing slash to the canonical origin", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/");
    expect(apiBaseUrl()).toBe("https://api.example.com");
  });

  it("normalizes mixed-case HTTPS to the canonical origin", () => {
    vi.stubEnv("VITE_API_BASE_URL", "HTTPS://API.EXAMPLE.COM/");
    expect(apiBaseUrl()).toBe("https://api.example.com");
  });

  it("rejects a non-root path", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/api");
    expect(() => apiBaseUrl()).toThrow(/path/);
  });

  it("rejects a query", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/?x=1");
    expect(() => apiBaseUrl()).toThrow(/query/);
  });

  it("rejects a hash", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/#x");
    expect(() => apiBaseUrl()).toThrow(/hash/);
  });

  it("rejects credentials", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://user:pass@api.example.com");
    expect(() => apiBaseUrl()).toThrow(/credentials/);
  });

  it("derives ws from http", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:3000");
    expect(apiBaseUrl()).toBe("http://localhost:3000");
    expect(wsBaseUrl()).toBe("ws://localhost:3000");
  });

  it("derives wss from https", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/");
    expect(apiBaseUrl()).toBe("https://api.example.com");
    expect(wsBaseUrl()).toBe("wss://api.example.com");
  });
});
