import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
      continue;
    }

    if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) {
      files.push(full);
    }
  }

  return files;
}

describe("landing market data sources", () => {
  it("does not request Binance from the browser", () => {
    const files = [
      ...sourceFiles(resolve("src/components/landing")),
      resolve("src/pages/LandingPage.tsx"),
    ];

    expect(files.length).toBeGreaterThan(5);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/https?:\/\/[^\s"'`]*binance/i);
      expect(source).not.toMatch(/wss?:\/\/[^\s"'`]*binance/i);
      expect(source).not.toMatch(/fstream\.binance/i);
      expect(source).not.toMatch(/fapi\.binance/i);
    }
  });
});
