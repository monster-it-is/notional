import { sql } from "drizzle-orm";
import {
  check,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const instrument = pgTable(
  "instrument",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    symbol: text("symbol").notNull().unique(),
    baseAsset: text("base_asset").notNull(),
    quoteAsset: text("quote_asset").notNull().default("USDT"),
    contractType: text("contract_type").notNull().default("PERPETUAL"),
    status: text("status").notNull().default("ACTIVE"),
    tickSize: numeric("tick_size", { precision: 38, scale: 18, mode: "string" }).notNull(),
    minPrice: numeric("min_price", { precision: 38, scale: 18, mode: "string" }).notNull(),
    maxPrice: numeric("max_price", { precision: 38, scale: 18, mode: "string" }).notNull(),
    stepSize: numeric("step_size", { precision: 38, scale: 18, mode: "string" }).notNull(),
    minQty: numeric("min_qty", { precision: 38, scale: 18, mode: "string" }).notNull(),
    maxQty: numeric("max_qty", { precision: 38, scale: 18, mode: "string" }).notNull(),
    marketStepSize: numeric("market_step_size", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    marketMinQty: numeric("market_min_qty", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    marketMaxQty: numeric("market_max_qty", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    minNotional: numeric("min_notional", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check("instrument_symbol_uppercase", sql`${table.symbol} = upper(${table.symbol})`),
    check("instrument_quote_asset_usdt", sql`${table.quoteAsset} = 'USDT'`),
    check(
      "instrument_contract_type_perpetual",
      sql`${table.contractType} = 'PERPETUAL'`,
    ),
    check("instrument_status_valid", sql`${table.status} in ('ACTIVE', 'INACTIVE')`),
    check("instrument_tick_size_non_negative", sql`${table.tickSize} >= 0`),
    check("instrument_min_price_non_negative", sql`${table.minPrice} >= 0`),
    check("instrument_max_price_non_negative", sql`${table.maxPrice} >= 0`),
    check("instrument_step_size_positive", sql`${table.stepSize} > 0`),
    check("instrument_min_qty_positive", sql`${table.minQty} > 0`),
    check("instrument_max_qty_positive", sql`${table.maxQty} > 0`),
    check("instrument_qty_range", sql`${table.maxQty} >= ${table.minQty}`),
    check("instrument_market_step_size_positive", sql`${table.marketStepSize} > 0`),
    check("instrument_market_min_qty_positive", sql`${table.marketMinQty} > 0`),
    check("instrument_market_max_qty_positive", sql`${table.marketMaxQty} > 0`),
    check(
      "instrument_market_qty_range",
      sql`${table.marketMaxQty} >= ${table.marketMinQty}`,
    ),
    check("instrument_min_notional_positive", sql`${table.minNotional} > 0`),
  ],
);
