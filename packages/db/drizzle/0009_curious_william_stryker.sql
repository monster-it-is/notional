ALTER TABLE "ledger_account" DROP CONSTRAINT "ledger_account_kind_valid";--> statement-breakpoint
ALTER TABLE "ledger_account" DROP CONSTRAINT "ledger_account_ownership";--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_transaction_event_type_valid";--> statement-breakpoint
ALTER TABLE "trade_order" ADD COLUMN "reserved_margin" numeric(38, 18) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_kind_valid" CHECK ("ledger_account"."kind" in ('USER_CASH', 'SYSTEM_VIRTUAL_FUNDING', 'SYSTEM_TRADING_PNL', 'SYSTEM_INSURANCE'));--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_ownership" CHECK ((
        ("ledger_account"."kind" = 'USER_CASH' AND "ledger_account"."paper_account_id" IS NOT NULL)
        OR
        (
          "ledger_account"."kind" in ('SYSTEM_VIRTUAL_FUNDING', 'SYSTEM_TRADING_PNL', 'SYSTEM_INSURANCE')
          AND "ledger_account"."paper_account_id" IS NULL
        )
      ));--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_event_type_valid" CHECK ("ledger_transaction"."event_type" in ('SIGNUP_ALLOCATION', 'FAUCET_CLAIM', 'REALIZED_PNL'));--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_reserved_margin_non_negative" CHECK ("trade_order"."reserved_margin" >= 0);--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_reserved_margin_lifecycle" CHECK ((
        ("trade_order"."order_type" = 'MARKET' AND "trade_order"."reserved_margin" = 0)
        OR
        ("trade_order"."status" in ('FILLED', 'CANCELLED') AND "trade_order"."reserved_margin" = 0)
        OR
        (
          "trade_order"."order_type" = 'LIMIT'
          AND "trade_order"."status" = 'OPEN'
          AND "trade_order"."reduce_only" = true
          AND "trade_order"."reserved_margin" = 0
        )
        OR
        (
          "trade_order"."order_type" = 'LIMIT'
          AND "trade_order"."status" = 'OPEN'
          AND "trade_order"."reduce_only" = false
          AND "trade_order"."reserved_margin" > 0
        )
      ));