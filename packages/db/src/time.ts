import { sql } from "drizzle-orm";

import type { FinancialTransaction } from "./executor.js";

export function utcTimestampFromEpochMs(epochMs: number) {
  if (!Number.isSafeInteger(epochMs)) {
    throw new Error("timestamp epoch ms must be a safe integer");
  }

  return sql`TIMESTAMP 'epoch' + ${epochMs} * interval '1 millisecond'`;
}

export function utcTimestampFromDate(value: Date) {
  return utcTimestampFromEpochMs(value.getTime());
}

export function fromUtcTimestamp(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || !/[zZ]|[+-]\d{2}/.test(value)) {
    throw new Error("timestamp must be timezone-aware");
  }

  return parsed;
}

export function toIsoUtc(value: Date): string {
  return value.toISOString();
}

export async function sampleFinancialTransactionTime(
  executor: FinancialTransaction,
): Promise<Date> {
  const result = await executor.execute(
    sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS financial_now`,
  );
  const [row] = result.rows as { financial_now: Date | string }[];

  if (!row) {
    throw new Error("financialNow sample failed");
  }

  return fromUtcTimestamp(row.financial_now);
}
