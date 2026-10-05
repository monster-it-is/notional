import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indicatorDir = resolve(process.cwd(), "src/lib/chart/indicators");

function source(file: string): string {
  return readFileSync(resolve(indicatorDir, file), "utf8");
}

function exportedFunction(file: string, name: string): string {
  const contents = source(file);
  const start = contents.indexOf(`export function ${name}`);

  expect(start).toBeGreaterThan(-1);

  const nextExport = contents.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? contents.slice(start) : contents.slice(start, nextExport);
}

function internalFunction(file: string, name: string): string {
  const contents = source(file);
  const start = contents.indexOf(`function ${name}`);

  expect(start).toBeGreaterThan(-1);

  const nextFn = contents.indexOf("\nfunction ", start + 1);
  const nextExport = contents.indexOf("\nexport ", start + 1);
  const endCandidates = [nextFn, nextExport].filter((index) => index > start);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : contents.length;
  return contents.slice(start, end);
}

describe("indicator session bootstrap complexity", () => {
  it("rebuilds SMA without per-bar append or growing point copies", () => {
    const rebuild = exportedFunction("sma.ts", "rebuildSma");
    expect(rebuild).not.toMatch(/appendSmaSample/);
    expect(rebuild).not.toMatch(/for \(const sample of samples\)/);

    const bootstrap = internalFunction("sma.ts", "bootstrapSmaFromSamples");
    expect(bootstrap).toMatch(/committedPoints\.push\(/);
    expect(bootstrap).not.toMatch(/\[\s*\.\.\.(?:committedPoints|points)/);
    expect(bootstrap).not.toMatch(/appendSmaSample/);
  });

  it("rebuilds EMA without per-bar append or growing point copies", () => {
    const rebuild = exportedFunction("ema.ts", "rebuildEmaFromSamples");
    expect(rebuild).not.toMatch(/appendEmaSample/);
    expect(rebuild).not.toMatch(/for \(const sample of samples\)/);

    const bootstrap = internalFunction("ema.ts", "bootstrapEmaFromSamples");
    expect(bootstrap).toMatch(/committedPoints\.push\(/);
    expect(bootstrap).not.toMatch(/\[\s*\.\.\.(?:committedPoints|committedValues|points|values)/);
    expect(bootstrap).not.toMatch(/appendEmaSample/);
  });

  it("rebuilds RSI without per-bar append or growing point copies", () => {
    const rebuild = exportedFunction("rsi.ts", "rebuildRsi");
    expect(rebuild).not.toMatch(/appendRsiSample/);
    expect(rebuild).not.toMatch(/for \(const sample of samples\)/);

    const bootstrap = internalFunction("rsi.ts", "bootstrapRsiFromSamples");
    expect(bootstrap).toMatch(/committedPoints\.push\(/);
    expect(bootstrap).not.toMatch(/\[\s*\.\.\.(?:committedPoints|points)/);
    expect(bootstrap).not.toMatch(/appendRsiSample/);
  });

  it("rebuilds Bollinger without per-bar append or growing point copies", () => {
    const rebuild = exportedFunction("bollinger.ts", "rebuildBollinger");
    expect(rebuild).not.toMatch(/appendBollingerSample/);
    expect(rebuild).not.toMatch(/for \(const sample of samples\)/);

    const bootstrap = internalFunction("bollinger.ts", "bootstrapBollingerFromSamples");
    expect(bootstrap).toMatch(/committedPoints\.push\(/);
    expect(bootstrap).not.toMatch(/\[\s*\.\.\.(?:committedPoints|points)/);
    expect(bootstrap).not.toMatch(/appendBollingerSample/);
  });

  it("rebuilds MACD from linear EMA bootstraps instead of sequential append", () => {
    const rebuild = exportedFunction("macd.ts", "rebuildMacd");
    expect(rebuild).not.toMatch(/appendMacdSample/);
    expect(rebuild).not.toMatch(/for \(const sample of samples\)/);
    expect(rebuild).toMatch(/rebuildEmaFromSamples/);
    expect(rebuild).toMatch(/assembleMacdPoints/);
  });
});
