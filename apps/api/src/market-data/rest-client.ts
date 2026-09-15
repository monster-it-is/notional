export type JsonFetcher = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

export class BinanceRestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinanceRestError";
  }
}

export function createBinanceRestClient(options: {
  restBaseUrl: string;
  timeoutMs: number;
  fetchImpl?: JsonFetcher;
  signal?: AbortSignal;
  maxRetries?: number;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 3;
  const base = options.restBaseUrl.replace(/\/$/, "");

  async function getJson(path: string): Promise<unknown> {
    const url = `${base}${path}`;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      if (options.signal?.aborted) {
        throw new BinanceRestError("binance request aborted");
      }

      try {
        const response = await fetchImpl(url, {
          signal: abortAfter(options.timeoutMs, options.signal),
        });

        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new BinanceRestError(`binance HTTP ${response.status} for ${path}`);
        }

        if (!response.ok) {
          lastError = new BinanceRestError(`binance HTTP ${response.status} for ${path}`);
          continue;
        }

        try {
          return (await response.json()) as unknown;
        } catch {
          throw new BinanceRestError(`binance returned malformed JSON for ${path}`);
        }
      } catch (error) {
        if (error instanceof BinanceRestError && !error.message.startsWith("binance HTTP 5")) {
          throw error;
        }

        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new BinanceRestError(`binance request failed for ${path}`);
  }

  return {
    getExchangeInfo: () => getJson("/fapi/v1/exchangeInfo"),
    getPremiumIndex: () => getJson("/fapi/v1/premiumIndex"),
    getBookTicker: () => getJson("/fapi/v1/ticker/bookTicker"),
    getFundingRate: (query: {
      symbol: string;
      startTime?: number;
      endTime?: number;
      limit?: number;
    }) => getJson(withQuery("/fapi/v1/fundingRate", query)),
    getMarkPriceKlines: (query: {
      symbol: string;
      interval: "1m";
      startTime?: number;
      endTime?: number;
      limit?: number;
    }) => getJson(withQuery("/fapi/v1/markPriceKlines", query)),
  };
}

function withQuery(
  path: string,
  query: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }

  const encoded = search.toString();
  return encoded === "" ? path : `${path}?${encoded}`;
}

function abortAfter(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }

  const onAbort = () => controller.abort();
  parent?.addEventListener("abort", onAbort, { once: true });

  if (parent?.aborted) {
    controller.abort();
  }

  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
    { once: true },
  );

  return controller.signal;
}
