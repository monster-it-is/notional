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
