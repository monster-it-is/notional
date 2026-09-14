import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { instrument } from "./instrument.js";
import { paperAccount } from "./paper-account.js";

export const liquidationEvent = pgTable(
  "liquidation_event",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    paperAccountId: uuid("paper_account_id")
      .notNull()
      .references(() => paperAccount.id, { onDelete: "restrict" }),
    marginMode: text("margin_mode").notNull(),
    instrumentId: uuid("instrument_id").references(() => instrument.id, {
      onDelete: "restrict",
    }),
    equity: numeric("equity", { precision: 38, scale: 18, mode: "string" }).notNull(),
    maintenanceMargin: numeric("maintenance_margin", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    check("liquidation_event_margin_mode_valid", sql`${table.marginMode} in ('CROSS', 'ISOLATED')`),
    check(
      "liquidation_event_instrument_by_mode",
      sql`(
        (${table.marginMode} = 'CROSS' AND ${table.instrumentId} IS NULL)
        OR
        (${table.marginMode} = 'ISOLATED' AND ${table.instrumentId} IS NOT NULL)
      )`,
    ),
    check("liquidation_event_maintenance_non_negative", sql`${table.maintenanceMargin} >= 0`),
    index("liquidation_event_paper_account_created_at_id_idx").on(
      table.paperAccountId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const liquidationEventRelations = relations(liquidationEvent, ({ one }) => ({
  paperAccount: one(paperAccount, {
    fields: [liquidationEvent.paperAccountId],
    references: [paperAccount.id],
  }),
  instrument: one(instrument, {
    fields: [liquidationEvent.instrumentId],
    references: [instrument.id],
  }),
}));
