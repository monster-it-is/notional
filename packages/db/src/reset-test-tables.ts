import { sql } from "drizzle-orm";

import { db, pool } from "./client.js";

export async function resetTestTables(): Promise<void> {
  await db.execute(
    sql`truncate table "session", "account", "verification", "paper_account", "user" cascade`,
  );
}

let poolEnd: Promise<void> | undefined;

export function endTestPool(): Promise<void> {
  poolEnd ??= pool.end();
  return poolEnd;
}
