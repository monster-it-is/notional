import { relations, sql } from "drizzle-orm";
import {
  check,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ledgerTransaction } from "./ledger.js";
import { paperAccount } from "./paper-account.js";

export const fundingEvent = pgTable(
  "funding_event",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    paperAccountId: uuid("paper_account_id")
      .notNull()
      .references(() => paperAccount.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    amount: numeric("amount", { precision: 38, scale: 18, mode: "string" }).notNull(),
    currency: text("currency").notNull().default("USDT"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    ledgerTransactionId: uuid("ledger_transaction_id")
      .notNull()
      .unique()
      .references(() => ledgerTransaction.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check(
      "funding_event_type_valid",
      sql`${table.eventType} = 'SIGNUP_ALLOCATION'`,
    ),
    check("funding_event_amount_positive", sql`${table.amount} > 0`),
    check("funding_event_currency_usdt", sql`${table.currency} = 'USDT'`),
    uniqueIndex("funding_event_signup_allocation_unique")
      .on(table.paperAccountId)
      .where(sql`${table.eventType} = 'SIGNUP_ALLOCATION'`),
  ],
);

export const fundingEventRelations = relations(fundingEvent, ({ one }) => ({
  paperAccount: one(paperAccount, {
    fields: [fundingEvent.paperAccountId],
    references: [paperAccount.id],
  }),
  ledgerTransaction: one(ledgerTransaction, {
    fields: [fundingEvent.ledgerTransactionId],
    references: [ledgerTransaction.id],
  }),
}));
