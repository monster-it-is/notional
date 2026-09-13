CREATE TABLE "trade_order" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"side" text NOT NULL,
	"order_type" text NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"limit_price" numeric(38, 18),
	"reduce_only" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trade_order_side_valid" CHECK ("trade_order"."side" in ('BUY', 'SELL')),
	CONSTRAINT "trade_order_type_valid" CHECK ("trade_order"."order_type" in ('MARKET', 'LIMIT')),
	CONSTRAINT "trade_order_status_valid" CHECK ("trade_order"."status" in ('OPEN', 'FILLED', 'CANCELLED')),
	CONSTRAINT "trade_order_quantity_positive" CHECK ("trade_order"."quantity" > 0),
	CONSTRAINT "trade_order_limit_price_by_type" CHECK ((
        ("trade_order"."order_type" = 'MARKET' AND "trade_order"."limit_price" IS NULL)
        OR
        ("trade_order"."order_type" = 'LIMIT' AND "trade_order"."limit_price" IS NOT NULL AND "trade_order"."limit_price" > 0)
      )),
	CONSTRAINT "trade_order_status_by_type" CHECK ((
        ("trade_order"."order_type" = 'MARKET' AND "trade_order"."status" = 'FILLED')
        OR
        ("trade_order"."order_type" = 'LIMIT' AND "trade_order"."status" in ('OPEN', 'FILLED', 'CANCELLED'))
      )),
	CONSTRAINT "trade_order_idempotency_key_shape" CHECK (char_length("trade_order"."idempotency_key") BETWEEN 1 AND 128
        AND "trade_order"."idempotency_key" = btrim("trade_order"."idempotency_key"))
);
--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_paper_account_id_paper_account_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_order_paper_account_idempotency_key_unique" ON "trade_order" USING btree ("paper_account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "trade_order_paper_account_created_at_id_idx" ON "trade_order" USING btree ("paper_account_id","created_at","id");--> statement-breakpoint
CREATE INDEX "trade_order_open_limit_by_instrument_idx" ON "trade_order" USING btree ("instrument_id","side","created_at","id") WHERE "trade_order"."status" = 'OPEN' AND "trade_order"."order_type" = 'LIMIT';