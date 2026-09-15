import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const files = [
  "src/components/OrderForm.tsx",
  "src/components/PositionsTable.tsx",
  "src/components/MarketTicker.tsx",
  "src/hooks/use-place-order.ts",
  "src/lib/decimal-string.ts",
  "src/lib/idempotency.ts",
  "src/stores/market-store.ts",
];

describe("financial number safeguards", () => {
  it("does not use Number/parseFloat/parseInt in quantity/price paths", () => {
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/\bparseFloat\s*\(/);
      expect(source).not.toMatch(/\bparseInt\s*\(/);
      expect(source).not.toMatch(/\bNumber\s*\(/);
    }
  });
});
