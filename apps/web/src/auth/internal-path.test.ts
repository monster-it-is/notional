import { describe, expect, it } from "vitest";

import { getSafeInternalPath } from "./internal-path.ts";

const SYNTHETIC_ORIGIN = "https://notional.invalid";

function parsedOrigin(value: string): string {
  return new URL(value, SYNTHETIC_ORIGIN).origin;
}

function expectInternalTarget(result: string | null): asserts result is string {
  expect(result).toEqual(expect.any(String));
  expect(parsedOrigin(result!)).toBe(SYNTHETIC_ORIGIN);
  expect(result!.startsWith("/")).toBe(true);
  expect(result!.startsWith("//")).toBe(false);
}

describe("getSafeInternalPath", () => {
  it("accepts application-internal absolute paths", () => {
    expectInternalTarget(getSafeInternalPath("/history"));
    expect(getSafeInternalPath("/history")).toBe("/history");
    expectInternalTarget(getSafeInternalPath("/trade"));
    expect(getSafeInternalPath("/trade")).toBe("/trade");
  });

  it("keeps query and hash on an internal path", () => {
    const result = getSafeInternalPath("/history?tab=open#positions");
    expectInternalTarget(result);
    expect(result).toBe("/history?tab=open#positions");
  });

  it("rejects absolute URLs", () => {
    expect(parsedOrigin("https://example.com")).not.toBe(SYNTHETIC_ORIGIN);
    expect(getSafeInternalPath("https://example.com")).toBeNull();
  });

  it("rejects protocol-relative paths", () => {
    expect(parsedOrigin("//example.com")).not.toBe(SYNTHETIC_ORIGIN);
    expect(getSafeInternalPath("//example.com")).toBeNull();
  });

  it("rejects a backslash path that URL-parses as another origin", () => {
    const candidate = "/\\evil.com";
    expect(parsedOrigin(candidate)).not.toBe(SYNTHETIC_ORIGIN);
    expect(getSafeInternalPath(candidate)).toBeNull();
  });

  it("rejects a newline path that URL-parses as a network-path URL", () => {
    const candidate = `/${"\n"}//evil.com`;
    expect(candidate.startsWith("/")).toBe(true);
    expect(candidate.startsWith("//")).toBe(false);
    expect(parsedOrigin(candidate)).not.toBe(SYNTHETIC_ORIGIN);
    expect(getSafeInternalPath(candidate)).toBeNull();
  });

  it("rejects missing values", () => {
    expect(getSafeInternalPath(null)).toBeNull();
    expect(getSafeInternalPath(undefined)).toBeNull();
    expect(getSafeInternalPath("")).toBeNull();
  });
});
