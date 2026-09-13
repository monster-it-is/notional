CREATE TABLE "ledger_account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"paper_account_id" uuid,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_kind_valid" CHECK ("ledger_account"."kind" in ('USER_CASH', 'SYSTEM_VIRTUAL_FUNDING')),
	CONSTRAINT "ledger_account_currency_usdt" CHECK ("ledger_account"."currency" = 'USDT'),
	CONSTRAINT "ledger_account_ownership" CHECK ((
        ("ledger_account"."kind" = 'USER_CASH' AND "ledger_account"."paper_account_id" IS NOT NULL)
        OR
        ("ledger_account"."kind" = 'SYSTEM_VIRTUAL_FUNDING' AND "ledger_account"."paper_account_id" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"ledger_transaction_id" uuid NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entry_amount_nonzero" CHECK ("ledger_entry"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transaction" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transaction_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_transaction_event_type_valid" CHECK ("ledger_transaction"."event_type" = 'SIGNUP_ALLOCATION')
);
--> statement-breakpoint
CREATE TABLE "funding_event" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"idempotency_key" text NOT NULL,
	"ledger_transaction_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "funding_event_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "funding_event_ledger_transaction_id_unique" UNIQUE("ledger_transaction_id"),
	CONSTRAINT "funding_event_type_valid" CHECK ("funding_event"."event_type" = 'SIGNUP_ALLOCATION'),
	CONSTRAINT "funding_event_amount_positive" CHECK ("funding_event"."amount" > 0),
	CONSTRAINT "funding_event_currency_usdt" CHECK ("funding_event"."currency" = 'USDT')
);
--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_paper_account_id_paper_account_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_ledger_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_ledger_account_id_ledger_account_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_event" ADD CONSTRAINT "funding_event_paper_account_id_paper_account_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_event" ADD CONSTRAINT "funding_event_ledger_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_account_user_cash_unique" ON "ledger_account" USING btree ("paper_account_id") WHERE "ledger_account"."paper_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_account_system_kind_unique" ON "ledger_account" USING btree ("kind") WHERE "ledger_account"."paper_account_id" IS NULL;--> statement-breakpoint
CREATE INDEX "ledger_entry_transaction_idx" ON "ledger_entry" USING btree ("ledger_transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_account_idx" ON "ledger_entry" USING btree ("ledger_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_event_signup_allocation_unique" ON "funding_event" USING btree ("paper_account_id") WHERE "funding_event"."event_type" = 'SIGNUP_ALLOCATION';