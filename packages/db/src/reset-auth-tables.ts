import { sql } from "drizzle-orm";

import { db } from "./client.js";

export async function resetAuthTables(): Promise<void> {
  await db.execute(
    sql`truncate table "session", "account", "verification", "user" cascade`,
  );
}
