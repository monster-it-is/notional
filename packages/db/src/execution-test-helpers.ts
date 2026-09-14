import { sql } from "drizzle-orm";

import { db } from "./client.js";

export async function setExecutionExecutedAtUtc(
  executionId: string,
  utcNaiveTimestamp: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE execution
    SET executed_at = ${utcNaiveTimestamp}::timestamp
    WHERE id = ${executionId}::uuid
  `);
}
