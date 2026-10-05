import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const files = [
  "src/components/OrderForm.tsx",
  "src/components/PositionsTable.tsx",
  "src/components/ClosePositionConfirm.tsx",
  "src/components/OpenOrdersTable.tsx",
  "src/components/MarketTicker.tsx",
  "src/components/ExecutionsTable.tsx",
  "src/components/OrdersHistoryTable.tsx",
  "src/components/PerpFundingTable.tsx",
  "src/components/LiquidationsTable.tsx",
  "src/components/OffsetPagination.tsx",
  "src/pages/TradePage.tsx",
  "src/pages/HistoryPage.tsx",
  "src/pages/AccountPage.tsx",
  "src/components/FaucetCard.tsx",
  "src/components/WalletFundingTable.tsx",
  "src/lib/format-exact-money.ts",
  "src/lib/faucet-eligibility.ts",
  "src/hooks/use-place-order.ts",
  "src/lib/decimal-string.ts",
  "src/lib/format-timestamp.ts",
  "src/lib/order-side-class.ts",
  "src/lib/canonical-symbol.ts",
  "src/lib/trade-feed-state.ts",
  "src/lib/idempotency.ts",
  "src/stores/market-store.ts",
  "src/components/trade/MarketChart.tsx",
  "src/lib/api/candles.ts",
  "src/lib/chart/merge-live-candle.ts",
  "src/lib/chart/classify-series-mutation.ts",
  "src/components/landing/leverage-lab-math.ts",
  "src/components/landing/format-decimal.ts",
];

describe("financial number safeguards", () => {
  it("does not use Number/parseFloat/parseInt in quantity/price paths", () => {
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/\bparseFloat\s*\(/);
      expect(source).not.toMatch(/\bparseInt\s*\(/);
      expect(source).not.toMatch(/\bNumber\s*\(/);
      expect(source).not.toMatch(/\.toFixed\s*\(/);
    }
  });

  it("keeps plotting Number conversion only in to-chart-candles", () => {
    const adapter = readFileSync(resolve(process.cwd(), "src/lib/chart/to-chart-candles.ts"), "utf8");
    expect(adapter).toMatch(/\bNumber\s*\(/);
    expect(adapter).toMatch(/Render-only/);

    const chart = readFileSync(resolve(process.cwd(), "src/components/trade/MarketChart.tsx"), "utf8");
    expect(chart).toMatch(/to-chart-candles/);

    for (const file of files.filter((path) => path !== "src/components/trade/MarketChart.tsx")) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/to-chart-candles/);
    }
  });
});

describe("D11B legend financial safeguards", () => {
  it("does not convert OHLCV with Number/parseFloat/parseInt in CandleLegend", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/trade/CandleLegend.tsx"), "utf8");
    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bparseInt\s*\(/);
  });

  it("does not convert financial fields in legend resolve", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/chart/resolve-legend-candle.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bparseInt\s*\(/);
    expect(source).not.toMatch(/\.toFixed\s*\(/);
  });

  it("allows timestamp Number APIs in lookup but not OHLCV conversion", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/chart/find-candle-by-chart-time.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bparseInt\s*\(/);
    expect(source).not.toMatch(/\bNumber\s*\(\s*candle\.(open|high|low|close|volume)/);
  });

  it("allows Decimal.toFixed in candle-change but not Number/parseFloat/parseInt", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/chart/candle-change.ts"), "utf8");
    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bparseInt\s*\(/);
    expect(source).toMatch(/\.toFixed\s*\(/);
  });
});

const indicatorCalculators = [
  "src/lib/chart/indicators/decimal.ts",
  "src/lib/chart/indicators/samples.ts",
  "src/lib/chart/indicators/sma.ts",
  "src/lib/chart/indicators/ema.ts",
  "src/lib/chart/indicators/rsi.ts",
  "src/lib/chart/indicators/macd.ts",
  "src/lib/chart/indicators/bollinger.ts",
  "src/lib/chart/indicators/compute-enabled.ts",
  "src/lib/chart/indicators/live-session.ts",
];

describe("D11C indicator financial safeguards", () => {
  it("forbids JS number conversion and Math.sqrt in indicator calculators", () => {
    for (const file of indicatorCalculators) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/\bparseFloat\s*\(/);
      expect(source).not.toMatch(/\bparseInt\s*\(/);
      expect(source).not.toMatch(/\bNumber\s*\(/);
      expect(source).not.toMatch(/Math\.sqrt/);
    }
  });

  it("keeps Bollinger multiplier as an exact decimal in settings", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/chart/indicators/settings.ts"), "utf8");
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).toMatch(/parseBollingerMultiplier/);
    expect(source).toMatch(/Number\.parseInt/);
  });

  it("keeps plotting Number conversion only in to-chart-indicators among indicator modules", () => {
    const adapter = readFileSync(resolve(process.cwd(), "src/lib/chart/to-chart-indicators.ts"), "utf8");
    expect(adapter).toMatch(/\bNumber\s*\(/);
    expect(adapter).toMatch(/Render-only/);
    expect(adapter).toMatch(/toChartUtcTimestamp/);
    expect(adapter).toMatch(/decimalVisualSign/);

    const chart = readFileSync(resolve(process.cwd(), "src/components/trade/MarketChart.tsx"), "utf8");
    expect(chart).toMatch(/to-chart-indicators/);

    for (const file of [...files, ...indicatorCalculators, "src/components/trade/CandleLegend.tsx"]) {
      if (file === "src/components/trade/MarketChart.tsx") {
        continue;
      }

      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/to-chart-indicators/);
    }
  });

  it("does not let indicator calculators import the candle render adapter", () => {
    for (const file of indicatorCalculators) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/to-chart-candles/);
    }
  });
});
