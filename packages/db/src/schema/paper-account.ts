import { relations, sql } from "drizzle-orm";
import {
  check,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";

export const paperAccount = pgTable(
  "paper_account",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" })
      .unique(),
    currency: text("currency").notNull().default("USDT"),
    balance: numeric("balance", { precision: 38, scale: 18, mode: "string" })
      .notNull()
      .default("0"),
    status: text("status").notNull().default("ACTIVE"),
    lastFaucetClaimAt: timestamp("last_faucet_claim_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check("paper_account_currency_usdt", sql`${table.currency} = 'USDT'`),
    check("paper_account_balance_non_negative", sql`${table.balance} >= 0`),
    check(
      "paper_account_status_valid",
      sql`${table.status} in ('ACTIVE', 'SUSPENDED')`,
    ),
  ],
);

export const paperAccountRelations = relations(paperAccount, ({ one }) => ({
  user: one(user, {
    fields: [paperAccount.userId],
    references: [user.id],
  }),
}));
