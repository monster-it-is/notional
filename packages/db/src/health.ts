import { sql } from "drizzle-orm";

import { db } from "./client.js";

export async function checkDatabaseHealth(): Promise<{ ok: true }> {
  await db.execute(sql`select 1`);
  return { ok: true };
}
