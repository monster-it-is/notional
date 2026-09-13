ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_transaction_event_type_valid";--> statement-breakpoint
ALTER TABLE "funding_event" DROP CONSTRAINT "funding_event_type_valid";--> statement-breakpoint
CREATE INDEX "funding_event_paper_account_created_at_idx" ON "funding_event" USING btree ("paper_account_id","created_at");--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_event_type_valid" CHECK ("ledger_transaction"."event_type" in ('SIGNUP_ALLOCATION', 'FAUCET_CLAIM'));--> statement-breakpoint
ALTER TABLE "funding_event" ADD CONSTRAINT "funding_event_type_valid" CHECK ("funding_event"."event_type" in ('SIGNUP_ALLOCATION', 'FAUCET_CLAIM'));