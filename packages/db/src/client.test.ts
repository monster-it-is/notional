import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { checkDatabaseHealth, db } from "./index.js";
import { endTestPool } from "./test.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("database connection", () => {
  afterAll(async () => {
    await endTestPool();
  });

  it("connects to PostgreSQL through Drizzle", async () => {
    const result = await db.execute(sql`select 1 as value`);

    expect(result.rows[0]).toEqual({
      value: 1,
    });
  });

  it("reports database health", async () => {
    await expect(checkDatabaseHealth()).resolves.toEqual({ ok: true });
  });

  it("keeps the runtime client on DATABASE_URL only", () => {
    const client = readFileSync(resolve(here, "client.ts"), "utf8");
    const index = readFileSync(resolve(here, "index.ts"), "utf8");
    expect(client).toMatch(/applicationDatabaseUrl\(/);
    expect(client).not.toMatch(/MIGRATION_DATABASE_URL/);
    expect(client).not.toMatch(/migrationDatabaseUrl/);
    expect(index).not.toMatch(/MIGRATION_DATABASE_URL/);
    expect(index).not.toMatch(/migrationDatabaseUrl/);
    expect(index).not.toMatch(/closeMigrationPool/);
  });
});
