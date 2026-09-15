import { sql } from "drizzle-orm";

import { db, pool } from "./client.js";

export async function resetTestTables(): Promise<void> {
  await db.execute(
    sql`truncate table
      "ledger_entry",
      "funding_event",
      "ledger_transaction",
      "ledger_account",
      "session",
      "account",
      "verification",
      "execution",
      "trade_order",
      "liquidation_event",
      "perp_funding_settlement",
      "perp_funding_account_settlement",
      "perp_funding_cycle",
      "perp_funding_source_state",
      "trading_position",
      "paper_account",
      "instrument",
      "user"
      cascade`,
  );
}

let poolEnd: Promise<void> | undefined;

export function endTestPool(): Promise<void> {
  poolEnd ??= pool.end();
  return poolEnd;
}
