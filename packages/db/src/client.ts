import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { applicationDatabaseUrl } from "./database-url.js";
import * as schema from "./schema/index.js";

export const pool = new Pool({
  connectionString: applicationDatabaseUrl(),
  max: poolMax(),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });

let closed: Promise<void> | undefined;

export function closePool(): Promise<void> {
  closed ??= pool.end();
  return closed;
}

function poolMax(): number {
  const raw = process.env.DATABASE_POOL_MAX;
  if (raw === undefined || raw === "") {
    return 10;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 10;
  }

  return parsed;
}
