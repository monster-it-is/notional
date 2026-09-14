import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { instrument } from "./instrument.js";
import { liquidationEvent } from "./liquidation.js";
import { paperAccount } from "./paper-account.js";

export const tradeOrder = pgTable(
  "trade_order",
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
    side: text("side").notNull(),
    orderType: text("order_type").notNull(),
    quantity: numeric("quantity", { precision: 38, scale: 18, mode: "string" }).notNull(),
    limitPrice: numeric("limit_price", { precision: 38, scale: 18, mode: "string" }),
    reduceOnly: boolean("reduce_only").notNull().default(false),
    reservedMargin: numeric("reserved_margin", {
      precision: 38,
      scale: 18,
      mode: "string",
    })
      .notNull()
      .default("0"),
    origin: text("origin").notNull().default("USER"),
    liquidationEventId: uuid("liquidation_event_id").references(() => liquidationEvent.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check("trade_order_side_valid", sql`${table.side} in ('BUY', 'SELL')`),
    check("trade_order_type_valid", sql`${table.orderType} in ('MARKET', 'LIMIT')`),
    check(
      "trade_order_status_valid",
      sql`${table.status} in ('OPEN', 'FILLED', 'CANCELLED')`,
    ),
    check("trade_order_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "trade_order_limit_price_by_type",
      sql`(
        (${table.orderType} = 'MARKET' AND ${table.limitPrice} IS NULL)
        OR
        (${table.orderType} = 'LIMIT' AND ${table.limitPrice} IS NOT NULL AND ${table.limitPrice} > 0)
      )`,
    ),
    check(
      "trade_order_status_by_type",
      sql`(
        (${table.orderType} = 'MARKET' AND ${table.status} = 'FILLED')
        OR
        (${table.orderType} = 'LIMIT' AND ${table.status} in ('OPEN', 'FILLED', 'CANCELLED'))
      )`,
    ),
    check(
      "trade_order_idempotency_key_shape",
      sql`char_length(${table.idempotencyKey}) BETWEEN 1 AND 128
        AND ${table.idempotencyKey} = btrim(${table.idempotencyKey})`,
    ),
    check("trade_order_origin_valid", sql`${table.origin} in ('USER', 'LIQUIDATION')`),
    check(
      "trade_order_origin_event",
      sql`(
        (${table.origin} = 'USER' AND ${table.liquidationEventId} IS NULL)
        OR
        (${table.origin} = 'LIQUIDATION' AND ${table.liquidationEventId} IS NOT NULL)
      )`,
    ),
    check("trade_order_reserved_margin_non_negative", sql`${table.reservedMargin} >= 0`),
    check(
      "trade_order_reserved_margin_lifecycle",
      sql`(
        (${table.orderType} = 'MARKET' AND ${table.reservedMargin} = 0)
        OR
        (${table.status} in ('FILLED', 'CANCELLED') AND ${table.reservedMargin} = 0)
        OR
        (
          ${table.orderType} = 'LIMIT'
          AND ${table.status} = 'OPEN'
          AND ${table.reduceOnly} = true
          AND ${table.reservedMargin} = 0
        )
        OR
        (
          ${table.orderType} = 'LIMIT'
          AND ${table.status} = 'OPEN'
          AND ${table.reduceOnly} = false
          AND ${table.reservedMargin} > 0
        )
      )`,
    ),
    uniqueIndex("trade_order_paper_account_idempotency_key_unique").on(
      table.paperAccountId,
      table.idempotencyKey,
    ),
    index("trade_order_paper_account_created_at_id_idx").on(
      table.paperAccountId,
      table.createdAt,
      table.id,
    ),
    index("trade_order_open_limit_by_instrument_idx")
      .on(table.instrumentId, table.side, table.createdAt, table.id)
      .where(sql`${table.status} = 'OPEN' AND ${table.orderType} = 'LIMIT'`),
  ],
);

export const tradeOrderRelations = relations(tradeOrder, ({ one }) => ({
  paperAccount: one(paperAccount, {
    fields: [tradeOrder.paperAccountId],
    references: [paperAccount.id],
  }),
  instrument: one(instrument, {
    fields: [tradeOrder.instrumentId],
    references: [instrument.id],
  }),
  liquidationEvent: one(liquidationEvent, {
    fields: [tradeOrder.liquidationEventId],
    references: [liquidationEvent.id],
  }),
}));
