import { describe, expect, it } from "vitest";

import { formatCompactEpochMsUtc, formatEpochMsUtc, formatTimestamp } from "./format-timestamp.ts";

describe("formatTimestamp", () => {
  it("formats ISO timestamps without converting financial values", () => {
    expect(formatTimestamp("2024-01-02T03:04:05.123Z")).toBe("2024-01-02 03:04:05 UTC");
  });

  it("leaves non-ISO values unchanged aside from a missing T", () => {
    expect(formatTimestamp("t")).toBe("t");
  });
});

describe("formatEpochMsUtc", () => {
  it("formats candle openTime as explicit UTC", () => {
    expect(formatEpochMsUtc(1_499_040_000_000)).toBe("2017-07-03 00:00:00 UTC");
  });

  it("returns an unavailable marker for invalid epoch values", () => {
    expect(formatEpochMsUtc(Number.NaN)).toBe("—");
    expect(formatEpochMsUtc(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatEpochMsUtc(Number.NEGATIVE_INFINITY)).toBe("—");
    expect(formatEpochMsUtc(8.64e15 + 1)).toBe("—");
  });
});

describe("formatCompactEpochMsUtc", () => {
  const now = Date.UTC(2026, 9, 5, 12, 0, 0);

  it("shows HH:MM UTC on the same UTC calendar day", () => {
    expect(formatCompactEpochMsUtc(Date.UTC(2026, 9, 5, 20, 0, 0), now)).toBe("20:00 UTC");
  });

  it("includes a compact UTC date when the calendar day differs", () => {
    expect(formatCompactEpochMsUtc(Date.UTC(2026, 9, 6, 20, 0, 0), now)).toBe("06 Oct · 20:00 UTC");
    expect(formatCompactEpochMsUtc(Date.UTC(2026, 8, 5, 8, 5, 0), now)).toBe("05 Sep · 08:05 UTC");
  });

  it("returns an unavailable marker for invalid epoch values", () => {
    expect(formatCompactEpochMsUtc(Number.NaN, now)).toBe("—");
    expect(formatCompactEpochMsUtc(Number.POSITIVE_INFINITY, now)).toBe("—");
  });
});
