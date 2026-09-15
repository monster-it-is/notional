import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { paperAccount } from "./paper-account.js";

export const ledgerAccount = pgTable(
  "ledger_account",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    kind: text("kind").notNull(),
    paperAccountId: uuid("paper_account_id").references(() => paperAccount.id, {
      onDelete: "restrict",
    }),
    currency: text("currency").notNull().default("USDT"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check(
      "ledger_account_kind_valid",
      sql`${table.kind} in ('USER_CASH', 'SYSTEM_VIRTUAL_FUNDING', 'SYSTEM_TRADING_PNL', 'SYSTEM_INSURANCE', 'SYSTEM_FUNDING')`,
    ),
    check("ledger_account_currency_usdt", sql`${table.currency} = 'USDT'`),
    check(
      "ledger_account_ownership",
      sql`(
        (${table.kind} = 'USER_CASH' AND ${table.paperAccountId} IS NOT NULL)
        OR
        (
          ${table.kind} in ('SYSTEM_VIRTUAL_FUNDING', 'SYSTEM_TRADING_PNL', 'SYSTEM_INSURANCE', 'SYSTEM_FUNDING')
          AND ${table.paperAccountId} IS NULL
        )
      )`,
    ),
    uniqueIndex("ledger_account_user_cash_unique")
      .on(table.paperAccountId)
      .where(sql`${table.paperAccountId} IS NOT NULL`),
    uniqueIndex("ledger_account_system_kind_unique")
      .on(table.kind)
      .where(sql`${table.paperAccountId} IS NULL`),
  ],
);

export const ledgerTransaction = pgTable(
  "ledger_transaction",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check(
      "ledger_transaction_event_type_valid",
      sql`${table.eventType} in ('SIGNUP_ALLOCATION', 'FAUCET_CLAIM', 'REALIZED_PNL', 'FUNDING_PAYMENT')`,
    ),
  ],
);

export const ledgerEntry = pgTable(
  "ledger_entry",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    ledgerTransactionId: uuid("ledger_transaction_id")
      .notNull()
      .references(() => ledgerTransaction.id, { onDelete: "restrict" }),
    ledgerAccountId: uuid("ledger_account_id")
      .notNull()
      .references(() => ledgerAccount.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 38, scale: 18, mode: "string" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check("ledger_entry_amount_nonzero", sql`${table.amount} <> 0`),
    index("ledger_entry_transaction_idx").on(table.ledgerTransactionId),
    index("ledger_entry_account_idx").on(table.ledgerAccountId),
  ],
);

export const ledgerAccountRelations = relations(
  ledgerAccount,
  ({ one, many }) => ({
    paperAccount: one(paperAccount, {
      fields: [ledgerAccount.paperAccountId],
      references: [paperAccount.id],
    }),
    entries: many(ledgerEntry),
  }),
);

export const ledgerTransactionRelations = relations(
  ledgerTransaction,
  ({ many }) => ({
    entries: many(ledgerEntry),
  }),
);

export const ledgerEntryRelations = relations(ledgerEntry, ({ one }) => ({
  transaction: one(ledgerTransaction, {
    fields: [ledgerEntry.ledgerTransactionId],
    references: [ledgerTransaction.id],
  }),
  account: one(ledgerAccount, {
    fields: [ledgerEntry.ledgerAccountId],
    references: [ledgerAccount.id],
  }),
}));
