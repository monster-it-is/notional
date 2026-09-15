CREATE TABLE "perp_funding_account_settlement" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"funding_time" timestamp NOT NULL,
	"total_funding_payment" numeric(38, 18) NOT NULL,
	"user_wallet_delta" numeric(38, 18) NOT NULL,
	"insurance_absorption" numeric(38, 18) NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "perp_funding_account_settlement_insurance_non_negative" CHECK ("perp_funding_account_settlement"."insurance_absorption" >= 0)
);
--> statement-breakpoint
CREATE TABLE "perp_funding_cycle" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"funding_time" timestamp NOT NULL,
	"status" text NOT NULL,
	"funding_rate" numeric(38, 18),
	"mark_price" numeric(38, 18),
	"created_at" timestamp NOT NULL,
	"ready_at" timestamp,
	CONSTRAINT "perp_funding_cycle_status_valid" CHECK ("perp_funding_cycle"."status" in ('SCHEDULED', 'READY')),
	CONSTRAINT "perp_funding_cycle_payload_by_status" CHECK ((
        (
          "perp_funding_cycle"."status" = 'SCHEDULED'
          AND "perp_funding_cycle"."funding_rate" IS NULL
          AND "perp_funding_cycle"."mark_price" IS NULL
          AND "perp_funding_cycle"."ready_at" IS NULL
        )
        OR
        (
          "perp_funding_cycle"."status" = 'READY'
          AND "perp_funding_cycle"."funding_rate" IS NOT NULL
          AND abs("perp_funding_cycle"."funding_rate") < 1
          AND "perp_funding_cycle"."mark_price" IS NOT NULL
          AND "perp_funding_cycle"."mark_price" > 0
          AND "perp_funding_cycle"."ready_at" IS NOT NULL
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "perp_funding_settlement" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"funding_cycle_id" uuid NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"funding_account_settlement_id" uuid NOT NULL,
	"margin_mode" text NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"funding_payment" numeric(38, 18) NOT NULL,
	"isolated_margin_before" numeric(38, 18),
	"isolated_margin_after" numeric(38, 18),
	"created_at" timestamp NOT NULL,
	CONSTRAINT "perp_funding_settlement_margin_mode_valid" CHECK ("perp_funding_settlement"."margin_mode" in ('CROSS', 'ISOLATED')),
	CONSTRAINT "perp_funding_settlement_quantity_nonzero" CHECK ("perp_funding_settlement"."quantity" <> 0),
	CONSTRAINT "perp_funding_settlement_isolated_fields" CHECK ((
        (
          "perp_funding_settlement"."margin_mode" = 'CROSS'
          AND "perp_funding_settlement"."isolated_margin_before" IS NULL
          AND "perp_funding_settlement"."isolated_margin_after" IS NULL
        )
        OR
        (
          "perp_funding_settlement"."margin_mode" = 'ISOLATED'
          AND "perp_funding_settlement"."isolated_margin_before" IS NOT NULL
          AND "perp_funding_settlement"."isolated_margin_after" IS NOT NULL
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "perp_funding_source_state" (
	"instrument_id" uuid PRIMARY KEY NOT NULL,
	"activation_floor_at" timestamp NOT NULL,
	"last_realized_funding_time" timestamp,
	"next_funding_time" timestamp,
	"next_funding_time_observed_at" timestamp,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "perp_funding_source_state_next_observed" CHECK ((
        ("perp_funding_source_state"."next_funding_time" IS NULL AND "perp_funding_source_state"."next_funding_time_observed_at" IS NULL)
        OR
        ("perp_funding_source_state"."next_funding_time" IS NOT NULL AND "perp_funding_source_state"."next_funding_time_observed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "ledger_account" DROP CONSTRAINT "ledger_account_kind_valid";--> statement-breakpoint
ALTER TABLE "ledger_account" DROP CONSTRAINT "ledger_account_ownership";--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_transaction_event_type_valid";--> statement-breakpoint
ALTER TABLE "trading_position" DROP CONSTRAINT "trading_position_isolated_margin_by_mode";--> statement-breakpoint
ALTER TABLE "trading_position" ADD COLUMN "funding_cursor_at" timestamp DEFAULT (clock_timestamp() AT TIME ZONE 'UTC') NOT NULL;--> statement-breakpoint
ALTER TABLE "perp_funding_account_settlement" ADD CONSTRAINT "perp_funding_account_settlement_paper_account_id_paper_account_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perp_funding_cycle" ADD CONSTRAINT "perp_funding_cycle_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perp_funding_settlement" ADD CONSTRAINT "perp_funding_settlement_funding_cycle_id_perp_funding_cycle_id_fk" FOREIGN KEY ("funding_cycle_id") REFERENCES "public"."perp_funding_cycle"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perp_funding_settlement" ADD CONSTRAINT "perp_funding_settlement_paper_account_id_paper_account_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perp_funding_settlement" ADD CONSTRAINT "perp_funding_settlement_position_id_trading_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."trading_position"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perp_funding_settlement" ADD CONSTRAINT "perp_funding_settlement_funding_account_settlement_id_perp_funding_account_settlement_id_fk" FOREIGN KEY ("funding_account_settlement_id") REFERENCES "public"."perp_funding_account_settlement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perp_funding_source_state" ADD CONSTRAINT "perp_funding_source_state_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "perp_funding_account_settlement_account_time_unique" ON "perp_funding_account_settlement" USING btree ("paper_account_id","funding_time");--> statement-breakpoint
CREATE UNIQUE INDEX "perp_funding_cycle_instrument_funding_time_unique" ON "perp_funding_cycle" USING btree ("instrument_id","funding_time");--> statement-breakpoint
CREATE INDEX "perp_funding_cycle_status_funding_time_idx" ON "perp_funding_cycle" USING btree ("status","funding_time");--> statement-breakpoint
CREATE UNIQUE INDEX "perp_funding_settlement_cycle_account_unique" ON "perp_funding_settlement" USING btree ("funding_cycle_id","paper_account_id");--> statement-breakpoint
CREATE INDEX "perp_funding_settlement_account_created_at_id_idx" ON "perp_funding_settlement" USING btree ("paper_account_id","created_at","id");--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_kind_valid" CHECK ("ledger_account"."kind" in ('USER_CASH', 'SYSTEM_VIRTUAL_FUNDING', 'SYSTEM_TRADING_PNL', 'SYSTEM_INSURANCE', 'SYSTEM_FUNDING'));--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_ownership" CHECK ((
        ("ledger_account"."kind" = 'USER_CASH' AND "ledger_account"."paper_account_id" IS NOT NULL)
        OR
        (
          "ledger_account"."kind" in ('SYSTEM_VIRTUAL_FUNDING', 'SYSTEM_TRADING_PNL', 'SYSTEM_INSURANCE', 'SYSTEM_FUNDING')
          AND "ledger_account"."paper_account_id" IS NULL
        )
      ));--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_event_type_valid" CHECK ("ledger_transaction"."event_type" in ('SIGNUP_ALLOCATION', 'FAUCET_CLAIM', 'REALIZED_PNL', 'FUNDING_PAYMENT'));--> statement-breakpoint
ALTER TABLE "trading_position" ADD CONSTRAINT "trading_position_isolated_margin_by_mode" CHECK ((
        ("trading_position"."margin_mode" = 'CROSS' AND "trading_position"."isolated_margin" = 0)
        OR
        (
          "trading_position"."margin_mode" = 'ISOLATED'
          AND (
            ("trading_position"."quantity" = 0 AND "trading_position"."isolated_margin" = 0)
            OR
            ("trading_position"."quantity" <> 0 AND "trading_position"."isolated_margin" >= 0)
          )
        )
      ));