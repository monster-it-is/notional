import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  db,
  findInstrumentById,
  findInstrumentBySymbol,
  fromDbDecimal,
  instrument,
  listActiveInstruments,
  upsertInstrumentBySymbol,
  type UpsertInstrumentInput,
} from "./index.js";
import { endTestPool, postgresConstraint, resetTestTables } from "./test.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EIGHTEEN_SCALE = "0.123456789012345678";

describe("instrument", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("inserts a valid perpetual USDT instrument", async () => {
    const row = await upsertInstrumentBySymbol(db, btc());

    expect(row.id).toMatch(UUID_PATTERN);
    expect(row.symbol).toBe("BTCUSDT");
    expect(row.baseAsset).toBe("BTC");
    expect(row.quoteAsset).toBe("USDT");
    expect(row.contractType).toBe("PERPETUAL");
    expect(row.status).toBe("ACTIVE");
    expect(typeof row.tickSize).toBe("string");
    expect(row.tickSize).toBe("0.1");
    expect(typeof row.minNotional).toBe("string");
  });

  it("rejects a duplicate symbol at the database", async () => {
    await upsertInstrumentBySymbol(db, btc());

    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ symbol: "BTCUSDT" })),
      "instrument_symbol_unique",
    );
  });

  it("rejects a lowercase symbol at the database", async () => {
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ symbol: "btcusdt" })),
      "instrument_symbol_uppercase",
    );
  });

  it("rejects a non-USDT quote asset at the database", async () => {
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ quoteAsset: "USD" })),
      "instrument_quote_asset_usdt",
    );
  });

  it("rejects a non-perpetual contract type at the database", async () => {
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ contractType: "CURRENT_QUARTER" })),
      "instrument_contract_type_perpetual",
    );
  });

  it("rejects an invalid status at the database", async () => {
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ status: "TRADING" })),
      "instrument_status_valid",
    );
  });

  it("accepts PRICE_FILTER zeros as disabled-rule metadata", async () => {
    const [row] = await db
      .insert(instrument)
      .values(
        rawInstrument({
          tickSize: "0",
          minPrice: "0",
          maxPrice: "0",
        }),
      )
      .returning();

    expect(fromDbDecimal(row!.tickSize).isZero()).toBe(true);
    expect(fromDbDecimal(row!.minPrice).isZero()).toBe(true);
    expect(fromDbDecimal(row!.maxPrice).isZero()).toBe(true);
    expect(typeof row?.tickSize).toBe("string");
  });

  it("rejects negative PRICE_FILTER values at the database", async () => {
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ tickSize: "-0.1" })),
      "instrument_tick_size_non_negative",
    );
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ minPrice: "-1" })),
      "instrument_min_price_non_negative",
    );
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ maxPrice: "-1" })),
      "instrument_max_price_non_negative",
    );
  });

  it("rejects non-positive quantity step and size values", async () => {
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ stepSize: "0" })),
      "instrument_step_size_positive",
    );
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ minQty: "0" })),
      "instrument_min_qty_positive",
    );
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ maxQty: "0" })),
      "instrument_max_qty_positive",
    );
  });

  it("rejects max quantity below min quantity", async () => {
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ minQty: "2", maxQty: "1" })),
      "instrument_qty_range",
    );
  });

  it("rejects non-positive market quantity filters and invalid market range", async () => {
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ marketStepSize: "0" })),
      "instrument_market_step_size_positive",
    );
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ marketMinQty: "0" })),
      "instrument_market_min_qty_positive",
    );
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ marketMaxQty: "0" })),
      "instrument_market_max_qty_positive",
    );
    await expectRejectedConstraint(
      db.insert(instrument).values(
        rawInstrument({ marketMinQty: "5", marketMaxQty: "1" }),
      ),
      "instrument_market_qty_range",
    );
  });

  it("rejects a non-positive min notional at the database", async () => {
    await expectRejectedConstraint(
      db.insert(instrument).values(rawInstrument({ minNotional: "0" })),
      "instrument_min_notional_positive",
    );
  });

  it("round-trips 18-decimal filter strings without JS Number conversion", async () => {
    const row = await upsertInstrumentBySymbol(
      db,
      btc({
        tickSize: EIGHTEEN_SCALE,
        minPrice: EIGHTEEN_SCALE,
        maxPrice: "1000000.123456789012345678",
        stepSize: EIGHTEEN_SCALE,
        minQty: EIGHTEEN_SCALE,
        maxQty: "1000.123456789012345678",
        marketStepSize: EIGHTEEN_SCALE,
        marketMinQty: EIGHTEEN_SCALE,
        marketMaxQty: "100.123456789012345678",
        minNotional: "5.123456789012345678",
      }),
    );

    const loaded = await findInstrumentById(db, row.id);

    expect(loaded).not.toBeNull();
    expect(typeof loaded?.tickSize).toBe("string");
    expect(loaded?.tickSize).toBe(EIGHTEEN_SCALE);
    expect(loaded?.minPrice).toBe(EIGHTEEN_SCALE);
    expect(loaded?.maxPrice).toBe("1000000.123456789012345678");
    expect(loaded?.stepSize).toBe(EIGHTEEN_SCALE);
    expect(loaded?.minQty).toBe(EIGHTEEN_SCALE);
    expect(loaded?.maxQty).toBe("1000.123456789012345678");
    expect(loaded?.marketStepSize).toBe(EIGHTEEN_SCALE);
    expect(loaded?.marketMinQty).toBe(EIGHTEEN_SCALE);
    expect(loaded?.marketMaxQty).toBe("100.123456789012345678");
    expect(loaded?.minNotional).toBe("5.123456789012345678");
  });

  it("rejects a non-string filter value on the upsert helper", async () => {
    await expect(
      upsertInstrumentBySymbol(db, btc({ tickSize: 0.1 as unknown as string })),
    ).rejects.toThrow("financial value must be a string");
  });

  it("finds an instrument by symbol and id", async () => {
    const created = await upsertInstrumentBySymbol(db, btc());

    const bySymbol = await findInstrumentBySymbol(db, "BTCUSDT");
    const byId = await findInstrumentById(db, created.id);

    expect(bySymbol?.id).toBe(created.id);
    expect(byId?.symbol).toBe("BTCUSDT");
  });

  it("returns null for an unknown symbol", async () => {
    expect(await findInstrumentBySymbol(db, "ETHUSDT")).toBeNull();
  });

  it("lists ACTIVE instruments by symbol ASC and omits INACTIVE", async () => {
    await upsertInstrumentBySymbol(db, eth());
    await upsertInstrumentBySymbol(db, btc());
    await upsertInstrumentBySymbol(db, sol({ status: "INACTIVE" }));

    const listed = await listActiveInstruments(db);

    expect(listed.map((row) => row.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("retrieves an INACTIVE instrument by symbol", async () => {
    await upsertInstrumentBySymbol(db, sol({ status: "INACTIVE" }));

    const found = await findInstrumentBySymbol(db, "SOLUSDT");

    expect(found?.status).toBe("INACTIVE");
    expect(found?.symbol).toBe("SOLUSDT");
  });

  it("preserves UUID and updates mutable metadata on upsert", async () => {
    const first = await upsertInstrumentBySymbol(db, btc());
    const second = await upsertInstrumentBySymbol(
      db,
      btc({
        baseAsset: "BTC",
        status: "INACTIVE",
        tickSize: "0.01",
        minPrice: "0.01",
        maxPrice: "1000000",
        minNotional: "10",
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second.symbol).toBe("BTCUSDT");
    expect(second.status).toBe("INACTIVE");
    expect(second.tickSize).toBe("0.01");
    expect(second.minNotional).toBe("10");
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(
      first.updatedAt.getTime(),
    );
  });

  it("does not fail concurrent same-symbol upserts with a duplicate-key race", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        upsertInstrumentBySymbol(
          db,
          btc({
            tickSize: index % 2 === 0 ? "0.1" : "0.01",
          }),
        ),
      ),
    );

    const ids = new Set(results.map((row) => row.id));
    expect(ids.size).toBe(1);

    const rows = await db.select().from(instrument);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(results[0]?.id);
  });
});

function btc(overrides: Partial<UpsertInstrumentInput> = {}): UpsertInstrumentInput {
  return {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    status: "ACTIVE",
    tickSize: "0.1",
    minPrice: "0.1",
    maxPrice: "1000000",
    stepSize: "0.001",
    minQty: "0.001",
    maxQty: "1000",
    marketStepSize: "0.001",
    marketMinQty: "0.001",
    marketMaxQty: "120",
    minNotional: "5",
    ...overrides,
  };
}

function eth(overrides: Partial<UpsertInstrumentInput> = {}): UpsertInstrumentInput {
  return btc({
    symbol: "ETHUSDT",
    baseAsset: "ETH",
    tickSize: "0.01",
    minPrice: "0.01",
    ...overrides,
  });
}

function sol(overrides: Partial<UpsertInstrumentInput> = {}): UpsertInstrumentInput {
  return btc({
    symbol: "SOLUSDT",
    baseAsset: "SOL",
    tickSize: "0.001",
    minPrice: "0.001",
    ...overrides,
  });
}

function rawInstrument(
  overrides: Partial<typeof instrument.$inferInsert> = {},
): typeof instrument.$inferInsert {
  return {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    contractType: "PERPETUAL",
    status: "ACTIVE",
    tickSize: "0.1",
    minPrice: "0.1",
    maxPrice: "1000000",
    stepSize: "0.001",
    minQty: "0.001",
    maxQty: "1000",
    marketStepSize: "0.001",
    marketMinQty: "0.001",
    marketMaxQty: "120",
    minNotional: "5",
    ...overrides,
  };
}

async function expectRejectedConstraint(
  operation: Promise<unknown>,
  constraint: string,
): Promise<void> {
  await expect(operation).rejects.toSatisfy((error: unknown) => {
    return postgresConstraint(error) === constraint;
  });
}

