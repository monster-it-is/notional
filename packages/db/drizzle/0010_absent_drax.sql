CREATE TABLE "liquidation_event" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"margin_mode" text NOT NULL,
	"instrument_id" uuid,
	"equity" numeric(38, 18) NOT NULL,
	"maintenance_margin" numeric(38, 18) NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "liquidation_event_margin_mode_valid" CHECK ("liquidation_event"."margin_mode" in ('CROSS', 'ISOLATED')),
	CONSTRAINT "liquidation_event_instrument_by_mode" CHECK ((
        ("liquidation_event"."margin_mode" = 'CROSS' AND "liquidation_event"."instrument_id" IS NULL)
        OR
        ("liquidation_event"."margin_mode" = 'ISOLATED' AND "liquidation_event"."instrument_id" IS NOT NULL)
      )),
	CONSTRAINT "liquidation_event_maintenance_non_negative" CHECK ("liquidation_event"."maintenance_margin" >= 0)
);
--> statement-breakpoint
ALTER TABLE "trade_order" ADD COLUMN "origin" text DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_order" ADD COLUMN "liquidation_event_id" uuid;--> statement-breakpoint
ALTER TABLE "liquidation_event" ADD CONSTRAINT "liquidation_event_paper_account_id_paper_account_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidation_event" ADD CONSTRAINT "liquidation_event_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "liquidation_event_paper_account_created_at_id_idx" ON "liquidation_event" USING btree ("paper_account_id","created_at","id");--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_liquidation_event_id_liquidation_event_id_fk" FOREIGN KEY ("liquidation_event_id") REFERENCES "public"."liquidation_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_origin_valid" CHECK ("trade_order"."origin" in ('USER', 'LIQUIDATION'));--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_origin_event" CHECK ((
        ("trade_order"."origin" = 'USER' AND "trade_order"."liquidation_event_id" IS NULL)
        OR
        ("trade_order"."origin" = 'LIQUIDATION' AND "trade_order"."liquidation_event_id" IS NOT NULL)
      ));