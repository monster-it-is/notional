import { sql } from "drizzle-orm";

import type { FinancialTransaction } from "./executor.js";

export type FaucetCooldownState = {
  claimedAtUtc: string;
  eligible: boolean;
  nextClaimAt: Date | null;
};

type FaucetCooldownRow = {
  claimed_at_utc: string;
  eligible: boolean | string;
  next_claim_at: Date | string | null;
};

export async function readFaucetCooldownState(
  executor: FinancialTransaction,
  paperAccountId: string,
): Promise<FaucetCooldownState> {
  const result = await executor.execute(sql`
    SELECT
      to_char(clock.wall_clock, 'YYYY-MM-DD HH24:MI:SS.US') AS claimed_at_utc,
      (
        paper_account.last_faucet_claim_at IS NULL
        OR clock.wall_clock >= paper_account.last_faucet_claim_at + INTERVAL '24 hours'
      ) AS eligible,
      (paper_account.last_faucet_claim_at + INTERVAL '24 hours') AT TIME ZONE 'UTC'
        AS next_claim_at
    FROM paper_account
    CROSS JOIN LATERAL (
      SELECT clock_timestamp() AT TIME ZONE 'UTC' AS wall_clock
    ) AS clock
    WHERE paper_account.id = ${paperAccountId}
  `);

  const [row] = result.rows as FaucetCooldownRow[];

  if (!row) {
    throw new Error("paper_account missing after faucet cooldown read");
  }

  return {
    claimedAtUtc: row.claimed_at_utc,
    eligible: row.eligible === true || row.eligible === "t",
    nextClaimAt:
      row.next_claim_at === null ? null : toTimestamptzDate(row.next_claim_at),
  };
}

function toTimestamptzDate(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || !/[zZ]|[+-]\d{2}/.test(value)) {
    throw new Error("faucet nextClaimAt must be a timezone-aware timestamp");
  }

  return parsed;
}
