import { config } from "dotenv";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";

const loaded = config({ path: resolve(import.meta.dirname, "../../.env") });
const fileEnv = loaded.parsed ?? {};

export default async function setup(): Promise<void> {
  const adminDatabaseUrl = fileEnv.DATABASE_URL;
  const testDatabaseUrl = fileEnv.TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

  if (!adminDatabaseUrl) {
    throw new Error("DATABASE_URL is not defined");
  }

  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is not defined");
  }

  const client = new Client({ connectionString: adminDatabaseUrl });
  await client.connect();

  try {
    const result = await client.query(
      "select 1 from pg_database where datname = 'notional_test'",
    );

    if (result.rowCount === 0) {
      await client.query("create database notional_test");
    }
  } finally {
    await client.end();
  }

  execSync("pnpm --filter @notional/db db:migrate", {
    cwd: resolve(import.meta.dirname, "../.."),
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
    },
  });
}
