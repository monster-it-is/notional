import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "./client.js";

export function migrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
}

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
