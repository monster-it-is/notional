export class WebConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebConfigError";
  }
}

export function apiBaseUrl(): string {
  const value = import.meta.env.VITE_API_BASE_URL;
  if (typeof value !== "string" || value.length === 0) {
    throw new WebConfigError("VITE_API_BASE_URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WebConfigError("VITE_API_BASE_URL must be an absolute http or https URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebConfigError("VITE_API_BASE_URL must be an absolute http or https URL");
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new WebConfigError("VITE_API_BASE_URL must not include credentials");
  }

  if (parsed.search !== "") {
    throw new WebConfigError("VITE_API_BASE_URL must not include a query");
  }

  if (parsed.hash !== "") {
    throw new WebConfigError("VITE_API_BASE_URL must not include a hash");
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new WebConfigError("VITE_API_BASE_URL must not include a path");
  }

  return parsed.origin;
}

export function wsBaseUrl(): string {
  const api = new URL(apiBaseUrl());
  api.protocol = api.protocol === "https:" ? "wss:" : "ws:";
  return api.origin;
}

export function accountWsUrl(): string {
  return `${wsBaseUrl()}/ws/account`;
}

export function marketWsUrl(): string {
  return `${wsBaseUrl()}/ws/market`;
}
