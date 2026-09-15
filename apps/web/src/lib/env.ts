export function apiBaseUrl(): string {
  const value = import.meta.env.VITE_API_BASE_URL;
  if (typeof value === "string" && value.length > 0) {
    return value.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}

export function wsBaseUrl(): string {
  const api = apiBaseUrl();

  if (api.startsWith("https://")) {
    return `wss://${api.slice("https://".length)}`;
  }

  if (api.startsWith("http://")) {
    return `ws://${api.slice("http://".length)}`;
  }

  return api;
}

export function accountWsUrl(): string {
  return `${wsBaseUrl()}/ws/account`;
}

export function marketWsUrl(): string {
  return `${wsBaseUrl()}/ws/market`;
}
