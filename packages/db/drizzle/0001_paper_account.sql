CREATE TABLE "paper_account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"balance" numeric(38, 18) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"last_faucet_claim_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paper_account_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "paper_account_currency_usdt" CHECK ("paper_account"."currency" = 'USDT'),
	CONSTRAINT "paper_account_balance_non_negative" CHECK ("paper_account"."balance" >= 0),
	CONSTRAINT "paper_account_status_valid" CHECK ("paper_account"."status" in ('ACTIVE', 'SUSPENDED'))
);
--> statement-breakpoint
ALTER TABLE "paper_account" ADD CONSTRAINT "paper_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;