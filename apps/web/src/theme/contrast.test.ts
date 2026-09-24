import { describe, expect, it } from "vitest";

function channel(value: number): number {
  const linear = value / 255;
  return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const DARK = {
  background: "#0a0d13",
  surface: "#0d1119",
  surfaceSubtle: "#101620",
  primary: "#f2f5f9",
  secondary: "#93a1b4",
  muted: "#6b7a8f",
} as const;

const LIGHT = {
  background: "#f4f6f8",
  surface: "#ffffff",
  surfaceSubtle: "#eef2f6",
  primary: "#111722",
  secondary: "#526174",
  muted: "#5e6e80",
} as const;

describe("theme contrast", () => {
  it("meets AA for dark secondary text on background, surface, and surface-subtle", () => {
    for (const background of [DARK.background, DARK.surface, DARK.surfaceSubtle]) {
      expect(contrast(DARK.primary, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK.secondary, background)).toBeGreaterThanOrEqual(4.5);
    }

    expect(contrast("#0a0d13", "#f0b429")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#2ebd85", DARK.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#f0544c", DARK.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps dark muted below AA so it is not used for meaningful 10/11/12px text", () => {
    for (const background of [DARK.background, DARK.surface, DARK.surfaceSubtle]) {
      expect(contrast(DARK.muted, background)).toBeGreaterThanOrEqual(3);
      expect(contrast(DARK.muted, background)).toBeLessThan(4.5);
    }
  });

  it("meets AA for light secondary and muted on background, surface, and surface-subtle", () => {
    for (const background of [LIGHT.background, LIGHT.surface, LIGHT.surfaceSubtle]) {
      expect(contrast(LIGHT.primary, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(LIGHT.secondary, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(LIGHT.muted, background)).toBeGreaterThanOrEqual(4.5);
    }

    expect(contrast("#0a0d13", "#f0b429")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#17875a", LIGHT.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#c53d36", LIGHT.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#758396", LIGHT.background)).toBeLessThan(4.5);
  });
});
