import { ApiError, parseApiError } from "./errors.ts";

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;

  try {
    response = await fetch(path.startsWith("http") ? path : `${apiOrigin()}${path}`, {
      method,
      credentials: "include",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: error instanceof Error ? error.message : "NETWORK_ERROR",
    });
  }

  const body = await readBody(response);

  if (!response.ok) {
    const error = parseApiError(
      response.status,
      body,
      response.status === 401 ? "Unauthorized" : "REQUEST_FAILED",
    );

    if (error.status === 401) {
      unauthorizedHandler?.();
    }

    throw error;
  }

  return body as T;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function apiOrigin(): string {
  const value = import.meta.env.VITE_API_BASE_URL;
  if (typeof value === "string" && value.length > 0) {
    return value.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}
