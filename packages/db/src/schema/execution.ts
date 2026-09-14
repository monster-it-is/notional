import { relations, sql } from "drizzle-orm";
import { check, numeric, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { tradeOrder } from "./order.js";

export const execution = pgTable(
  "execution",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => tradeOrder.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 38, scale: 18, mode: "string" }).notNull(),
    price: numeric("price", { precision: 38, scale: 18, mode: "string" }).notNull(),
    executedAt: timestamp("executed_at").notNull(),
  },
  (table) => [
    check("execution_quantity_positive", sql`${table.quantity} > 0`),
    check("execution_price_positive", sql`${table.price} > 0`),
    uniqueIndex("execution_order_id_unique").on(table.orderId),
  ],
);

export const executionRelations = relations(execution, ({ one }) => ({
  order: one(tradeOrder, {
    fields: [execution.orderId],
    references: [tradeOrder.id],
  }),
}));
