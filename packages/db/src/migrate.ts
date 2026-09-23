import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import { migrationDatabaseUrl } from "./database-url.js";

export function migrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
}

let pool: Pool | undefined;
let closed: Promise<void> | undefined;

export async function runMigrations(): Promise<void> {
  await migrate(drizzle(migrationPool()), {
    migrationsFolder: migrationsFolder(),
  });
}

export function closeMigrationPool(): Promise<void> {
  if (pool === undefined) {
    return Promise.resolve();
  }

  closed ??= pool.end();
  return closed;
}

function migrationPool(): Pool {
  pool ??= new Pool({
    connectionString: migrationDatabaseUrl(),
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}
