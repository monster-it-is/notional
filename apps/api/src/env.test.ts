import { describe, expect, it } from "vitest";

import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("parses FAUCET_AMOUNT as a MoneyDecimal", () => {
    const parsed = parseEnv(process.env);

    expect(parsed.FAUCET_AMOUNT.isPositive()).toBe(true);
    expect(typeof parsed.FAUCET_AMOUNT.toString()).toBe("string");
  });

  it("rejects missing and empty FAUCET_AMOUNT", () => {
    const missing = { ...process.env };
    delete missing.FAUCET_AMOUNT;

    expect(() => parseEnv(missing)).toThrow();
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "" })).toThrow();
  });

  it("rejects invalid FAUCET_AMOUNT values", () => {
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "0" })).toThrow(
      "configured money must be a positive decimal",
    );
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "-1" })).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "1e2" })).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() => parseEnv({ ...process.env, FAUCET_AMOUNT: "abc" })).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() =>
      parseEnv({ ...process.env, FAUCET_AMOUNT: "1.1234567890123456789" }),
    ).toThrow("financial value exceeds 18 decimal places");
    expect(() =>
      parseEnv({ ...process.env, FAUCET_AMOUNT: `1${"0".repeat(20)}` }),
    ).toThrow("financial value exceeds NUMERIC(38,18) precision");
  });
});
