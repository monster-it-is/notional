CREATE TABLE "execution" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"executed_at" timestamp NOT NULL,
	CONSTRAINT "execution_quantity_positive" CHECK ("execution"."quantity" > 0),
	CONSTRAINT "execution_price_positive" CHECK ("execution"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "execution" ADD CONSTRAINT "execution_order_id_trade_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trade_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_order_id_unique" ON "execution" USING btree ("order_id");