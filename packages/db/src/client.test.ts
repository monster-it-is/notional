import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { checkDatabaseHealth, db, pool } from "./index.js";

describe("database connection", () => {
  afterAll(async () => {
    await pool.end();
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
});
