import { describe, expect, it } from "vitest";

import { formatTimestamp } from "./format-timestamp.ts";

describe("formatTimestamp", () => {
  it("formats ISO timestamps without converting financial values", () => {
    expect(formatTimestamp("2024-01-02T03:04:05.123Z")).toBe("2024-01-02 03:04:05 UTC");
  });

  it("leaves non-ISO values unchanged aside from a missing T", () => {
    expect(formatTimestamp("t")).toBe("t");
  });
});
