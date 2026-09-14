import { relations, sql } from "drizzle-orm";
import {
  check,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { instrument } from "./instrument.js";
import { paperAccount } from "./paper-account.js";

export const tradingPosition = pgTable(
  "trading_position",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    paperAccountId: uuid("paper_account_id")
      .notNull()
      .references(() => paperAccount.id, { onDelete: "restrict" }),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrument.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 38, scale: 18, mode: "string" })
      .notNull()
      .default("0"),
    entryPrice: numeric("entry_price", { precision: 38, scale: 18, mode: "string" }),
    realizedPnl: numeric("realized_pnl", { precision: 38, scale: 18, mode: "string" })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    check(
      "trading_position_qty_entry_invariant",
      sql`(
        (${table.quantity} = 0 AND ${table.entryPrice} IS NULL)
        OR
        (${table.quantity} <> 0 AND ${table.entryPrice} IS NOT NULL AND ${table.entryPrice} > 0)
      )`,
    ),
    uniqueIndex("trading_position_paper_account_instrument_unique").on(
      table.paperAccountId,
      table.instrumentId,
    ),
  ],
);

export const tradingPositionRelations = relations(tradingPosition, ({ one }) => ({
  paperAccount: one(paperAccount, {
    fields: [tradingPosition.paperAccountId],
    references: [paperAccount.id],
  }),
  instrument: one(instrument, {
    fields: [tradingPosition.instrumentId],
    references: [instrument.id],
  }),
}));
