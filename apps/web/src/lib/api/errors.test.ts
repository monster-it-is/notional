import { describe, expect, it } from "vitest";

import { ApiError, formatApiErrorMessage, parseApiError } from "./errors.ts";

describe("API errors", () => {
  it("parses coded JSON bodies", () => {
    const error = parseApiError(409, { error: "FAUCET_COOLDOWN", nextClaimAt: "2026-01-01T00:00:00.000Z" }, "X");
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("FAUCET_COOLDOWN");
    expect(error.nextClaimAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("includes order reasons", () => {
    const error = parseApiError(400, { error: "INVALID_ORDER", reason: "MIN_NOTIONAL" }, "X");
    expect(error.reason).toBe("MIN_NOTIONAL");
    expect(formatApiErrorMessage(error.code, error.reason)).toBe("INVALID_ORDER: MIN_NOTIONAL");
  });

  it("maps 503 fail-closed codes", () => {
    expect(parseApiError(503, { error: "FUNDING_DATA_UNAVAILABLE" }, "X").code).toBe(
      "FUNDING_DATA_UNAVAILABLE",
    );
    expect(parseApiError(503, { error: "MARKET_DATA_UNAVAILABLE" }, "X").code).toBe(
      "MARKET_DATA_UNAVAILABLE",
    );
  });
});
