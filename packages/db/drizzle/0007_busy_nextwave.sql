CREATE TABLE "trading_position" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"quantity" numeric(38, 18) DEFAULT '0' NOT NULL,
	"entry_price" numeric(38, 18),
	"realized_pnl" numeric(38, 18) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trading_position_qty_entry_invariant" CHECK ((
        ("trading_position"."quantity" = 0 AND "trading_position"."entry_price" IS NULL)
        OR
        ("trading_position"."quantity" <> 0 AND "trading_position"."entry_price" IS NOT NULL AND "trading_position"."entry_price" > 0)
      ))
);
--> statement-breakpoint
ALTER TABLE "trading_position" ADD CONSTRAINT "trading_position_paper_account_id_paper_account_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_position" ADD CONSTRAINT "trading_position_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trading_position_paper_account_instrument_unique" ON "trading_position" USING btree ("paper_account_id","instrument_id");