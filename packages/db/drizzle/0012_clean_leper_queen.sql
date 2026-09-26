ALTER TABLE "ledger_transaction" ADD COLUMN "paper_account_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_paper_account_id_paper_account_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ledger_entry e
    INNER JOIN ledger_account a ON a.id = e.ledger_account_id
    WHERE a.kind = 'USER_CASH'
    GROUP BY e.ledger_transaction_id
    HAVING COUNT(DISTINCT a.paper_account_id) > 1
  ) THEN
    RAISE EXCEPTION 'ledger_transaction has USER_CASH entries for more than one paper_account_id';
  END IF;
END $$;--> statement-breakpoint
UPDATE ledger_transaction AS t
SET paper_account_id = cash.paper_account_id
FROM (
  SELECT DISTINCT e.ledger_transaction_id, a.paper_account_id
  FROM ledger_entry e
  INNER JOIN ledger_account a ON a.id = e.ledger_account_id
  WHERE a.kind = 'USER_CASH'
    AND a.paper_account_id IS NOT NULL
) AS cash
WHERE t.id = cash.ledger_transaction_id
  AND t.paper_account_id IS NULL;--> statement-breakpoint
UPDATE ledger_transaction AS t
SET paper_account_id = o.paper_account_id
FROM execution ex
INNER JOIN trade_order o ON o.id = ex.order_id
WHERE t.paper_account_id IS NULL
  AND t.event_type = 'REALIZED_PNL'
  AND t.idempotency_key = 'realized-pnl:' || ex.id::text;--> statement-breakpoint
UPDATE ledger_transaction AS t
SET paper_account_id = le.paper_account_id
FROM liquidation_event le
WHERE t.paper_account_id IS NULL
  AND t.event_type = 'REALIZED_PNL'
  AND t.idempotency_key = 'liquidation-realized:' || le.id::text;--> statement-breakpoint
UPDATE ledger_transaction AS t
SET paper_account_id = s.paper_account_id
FROM perp_funding_account_settlement s
WHERE t.paper_account_id IS NULL
  AND t.event_type = 'FUNDING_PAYMENT'
  AND t.idempotency_key = 'funding-payment:' || s.id::text;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ledger_transaction WHERE paper_account_id IS NULL
  ) THEN
    RAISE EXCEPTION 'unattributed ledger_transaction rows remain';
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ledger_entry e
    INNER JOIN ledger_account a ON a.id = e.ledger_account_id
    INNER JOIN ledger_transaction t ON t.id = e.ledger_transaction_id
    WHERE a.kind = 'USER_CASH'
      AND a.paper_account_id IS DISTINCT FROM t.paper_account_id
  ) THEN
    RAISE EXCEPTION 'USER_CASH entry paper_account_id disagrees with ledger_transaction.paper_account_id';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ALTER COLUMN "paper_account_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "ledger_transaction_paper_account_event_created_idx" ON "ledger_transaction" USING btree ("paper_account_id","event_type","created_at");
