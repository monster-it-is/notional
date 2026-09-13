import { eq, sql } from "drizzle-orm";

import { db } from "./client.js";
import { paperAccount } from "./schema/paper-account.js";

export async function setLastFaucetClaimElapsed24h(
  paperAccountId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE paper_account
    SET last_faucet_claim_at = clock_timestamp() AT TIME ZONE 'UTC' - INTERVAL '24 hours'
    WHERE id = ${paperAccountId}
  `);
}

export async function setLastFaucetClaimBefore24h(
  paperAccountId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE paper_account
    SET last_faucet_claim_at =
      clock_timestamp() AT TIME ZONE 'UTC' - INTERVAL '24 hours' + INTERVAL '1 minute'
    WHERE id = ${paperAccountId}
  `);
}

export async function setPaperAccountStatusForTests(
  paperAccountId: string,
  status: "ACTIVE" | "SUSPENDED",
): Promise<void> {
  await db
    .update(paperAccount)
    .set({ status })
    .where(eq(paperAccount.id, paperAccountId));
}

export async function setLastFaucetClaimAtUtc(
  paperAccountId: string,
  utcNaiveTimestamp: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE paper_account
    SET last_faucet_claim_at = ${utcNaiveTimestamp}::timestamp
    WHERE id = ${paperAccountId}
  `);
}
