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

import { instrument } from "./instrument.js";
import { paperAccount } from "./paper-account.js";
import { tradingPosition } from "./position.js";

export const perpFundingSourceState = pgTable(
  "perp_funding_source_state",
  {
    instrumentId: uuid("instrument_id")
      .primaryKey()
      .references(() => instrument.id, { onDelete: "restrict" }),
    activationFloorAt: timestamp("activation_floor_at").notNull(),
    lastRealizedFundingTime: timestamp("last_realized_funding_time"),
    nextFundingTime: timestamp("next_funding_time"),
    nextFundingTimeObservedAt: timestamp("next_funding_time_observed_at"),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    check(
      "perp_funding_source_state_next_observed",
      sql`(
        (${table.nextFundingTime} IS NULL AND ${table.nextFundingTimeObservedAt} IS NULL)
        OR
        (${table.nextFundingTime} IS NOT NULL AND ${table.nextFundingTimeObservedAt} IS NOT NULL)
      )`,
    ),
  ],
);

export const perpFundingCycle = pgTable(
  "perp_funding_cycle",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrument.id, { onDelete: "restrict" }),
    fundingTime: timestamp("funding_time").notNull(),
    status: text("status").notNull(),
    fundingRate: numeric("funding_rate", { precision: 38, scale: 18, mode: "string" }),
    markPrice: numeric("mark_price", { precision: 38, scale: 18, mode: "string" }),
    createdAt: timestamp("created_at").notNull(),
    readyAt: timestamp("ready_at"),
  },
  (table) => [
    check("perp_funding_cycle_status_valid", sql`${table.status} in ('SCHEDULED', 'READY')`),
    check(
      "perp_funding_cycle_payload_by_status",
      sql`(
        (
          ${table.status} = 'SCHEDULED'
          AND ${table.fundingRate} IS NULL
          AND ${table.markPrice} IS NULL
          AND ${table.readyAt} IS NULL
        )
        OR
        (
          ${table.status} = 'READY'
          AND ${table.fundingRate} IS NOT NULL
          AND abs(${table.fundingRate}) < 1
          AND ${table.markPrice} IS NOT NULL
          AND ${table.markPrice} > 0
          AND ${table.readyAt} IS NOT NULL
        )
      )`,
    ),
    uniqueIndex("perp_funding_cycle_instrument_funding_time_unique").on(
      table.instrumentId,
      table.fundingTime,
    ),
    index("perp_funding_cycle_status_funding_time_idx").on(table.status, table.fundingTime),
  ],
);

export const perpFundingAccountSettlement = pgTable(
  "perp_funding_account_settlement",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    paperAccountId: uuid("paper_account_id")
      .notNull()
      .references(() => paperAccount.id, { onDelete: "restrict" }),
    fundingTime: timestamp("funding_time").notNull(),
    totalFundingPayment: numeric("total_funding_payment", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    userWalletDelta: numeric("user_wallet_delta", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    insuranceAbsorption: numeric("insurance_absorption", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    check(
      "perp_funding_account_settlement_insurance_non_negative",
      sql`${table.insuranceAbsorption} >= 0`,
    ),
    uniqueIndex("perp_funding_account_settlement_account_time_unique").on(
      table.paperAccountId,
      table.fundingTime,
    ),
  ],
);

export const perpFundingSettlement = pgTable(
  "perp_funding_settlement",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    fundingCycleId: uuid("funding_cycle_id")
      .notNull()
      .references(() => perpFundingCycle.id, { onDelete: "restrict" }),
    paperAccountId: uuid("paper_account_id")
      .notNull()
      .references(() => paperAccount.id, { onDelete: "restrict" }),
    positionId: uuid("position_id")
      .notNull()
      .references(() => tradingPosition.id, { onDelete: "restrict" }),
    fundingAccountSettlementId: uuid("funding_account_settlement_id")
      .notNull()
      .references(() => perpFundingAccountSettlement.id, { onDelete: "restrict" }),
    marginMode: text("margin_mode").notNull(),
    quantity: numeric("quantity", { precision: 38, scale: 18, mode: "string" }).notNull(),
    fundingPayment: numeric("funding_payment", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    isolatedMarginBefore: numeric("isolated_margin_before", {
      precision: 38,
      scale: 18,
      mode: "string",
    }),
    isolatedMarginAfter: numeric("isolated_margin_after", {
      precision: 38,
      scale: 18,
      mode: "string",
    }),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    check(
      "perp_funding_settlement_margin_mode_valid",
      sql`${table.marginMode} in ('CROSS', 'ISOLATED')`,
    ),
    check("perp_funding_settlement_quantity_nonzero", sql`${table.quantity} <> 0`),
    check(
      "perp_funding_settlement_isolated_fields",
      sql`(
        (
          ${table.marginMode} = 'CROSS'
          AND ${table.isolatedMarginBefore} IS NULL
          AND ${table.isolatedMarginAfter} IS NULL
        )
        OR
        (
          ${table.marginMode} = 'ISOLATED'
          AND ${table.isolatedMarginBefore} IS NOT NULL
          AND ${table.isolatedMarginAfter} IS NOT NULL
        )
      )`,
    ),
    uniqueIndex("perp_funding_settlement_cycle_account_unique").on(
      table.fundingCycleId,
      table.paperAccountId,
    ),
    index("perp_funding_settlement_account_created_at_id_idx").on(
      table.paperAccountId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const perpFundingSourceStateRelations = relations(perpFundingSourceState, ({ one }) => ({
  instrument: one(instrument, {
    fields: [perpFundingSourceState.instrumentId],
    references: [instrument.id],
  }),
}));

export const perpFundingCycleRelations = relations(perpFundingCycle, ({ one, many }) => ({
  instrument: one(instrument, {
    fields: [perpFundingCycle.instrumentId],
    references: [instrument.id],
  }),
  settlements: many(perpFundingSettlement),
}));

export const perpFundingAccountSettlementRelations = relations(
  perpFundingAccountSettlement,
  ({ one, many }) => ({
    paperAccount: one(paperAccount, {
      fields: [perpFundingAccountSettlement.paperAccountId],
      references: [paperAccount.id],
    }),
    settlements: many(perpFundingSettlement),
  }),
);

export const perpFundingSettlementRelations = relations(perpFundingSettlement, ({ one }) => ({
  cycle: one(perpFundingCycle, {
    fields: [perpFundingSettlement.fundingCycleId],
    references: [perpFundingCycle.id],
  }),
  paperAccount: one(paperAccount, {
    fields: [perpFundingSettlement.paperAccountId],
    references: [paperAccount.id],
  }),
  position: one(tradingPosition, {
    fields: [perpFundingSettlement.positionId],
    references: [tradingPosition.id],
  }),
  accountSettlement: one(perpFundingAccountSettlement, {
    fields: [perpFundingSettlement.fundingAccountSettlementId],
    references: [perpFundingAccountSettlement.id],
  }),
}));
