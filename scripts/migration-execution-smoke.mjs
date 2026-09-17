import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnv(path) {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(resolve(dirname(fileURLToPath(import.meta.url)), "../.env"));

const SMOKE_DB = "notional_migrate_smoke";
const REQUIRED_TABLES = ["instrument", "paper_account", "trade_order"];

const targetArg = process.argv[2];
if (!targetArg) {
  throw new Error("usage: node scripts/migration-execution-smoke.mjs <deploy-dir>");
}

const target = resolve(targetArg);
const migrateEntry = resolve(target, "node_modules/@notional/db/dist/migrate-entry.js");
if (!existsSync(migrateEntry)) {
  throw new Error(`missing compiled migration entry: ${migrateEntry}`);
}

const adminUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
}

const admin = new URL(adminUrl);
const maintenanceUrl = admin;
const smokeUrl = new URL(adminUrl);
smokeUrl.pathname = `/${SMOKE_DB}`;

function runEval(databaseUrl, source) {
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "NODE_OPTIONS") {
      delete env[key];
    }
  }

  const spawned = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: target,
    env,
    encoding: "utf8",
  });

  if (spawned.stdout) {
    process.stdout.write(spawned.stdout);
  }
  if (spawned.stderr) {
    process.stderr.write(spawned.stderr);
  }
  if (spawned.status !== 0) {
    throw new Error(`migration smoke eval failed with status ${spawned.status ?? "null"}`);
  }

  return spawned.stdout ?? "";
}

const pgHelper = `
import { createRequire } from "node:module";
const require = createRequire(import.meta.resolve("@notional/db"));
const pg = require("pg");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
`;

try {
  runEval(
    maintenanceUrl.href,
    `${pgHelper}
await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${SMOKE_DB}' AND pid <> pg_backend_pid()");
await client.query("DROP DATABASE IF EXISTS ${SMOKE_DB}");
await client.query("CREATE DATABASE ${SMOKE_DB}");
await client.end();
console.log("ok disposable database");
`,
  );

  const migrateEnv = { ...process.env, DATABASE_URL: smokeUrl.href };
  for (const key of Object.keys(migrateEnv)) {
    if (key.toUpperCase() === "NODE_OPTIONS") {
      delete migrateEnv[key];
    }
  }
  const migrated = spawnSync(process.execPath, [migrateEntry], {
    cwd: target,
    env: migrateEnv,
    encoding: "utf8",
  });
  if (migrated.stdout) {
    process.stdout.write(migrated.stdout);
  }
  if (migrated.stderr) {
    process.stderr.write(migrated.stderr);
  }
  if (migrated.status !== 0) {
    throw new Error(`migration entry exited ${migrated.status ?? "null"}`);
  }
  console.log("ok migrate-entry executed");

  const rowsOut = runEval(
    smokeUrl.href,
    `${pgHelper}
const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
const journal = await client.query("SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations");
console.log(JSON.stringify({ tables: tables.rows.map((row) => row.tablename), migrations: journal.rows[0].n }));
await client.end();
`,
  );

  const proof = JSON.parse(rowsOut.trim().split("\n").at(-1));
  for (const name of REQUIRED_TABLES) {
    if (!proof.tables.includes(name)) {
      throw new Error(`missing table ${name} after migration; got ${proof.tables.join(",")}`);
    }
  }
  if (!Number.isInteger(proof.migrations) || proof.migrations < 1) {
    throw new Error("drizzle migration journal is empty");
  }
  console.log(`ok schema tables=${proof.tables.length} migrations=${proof.migrations}`);
} finally {
  try {
    runEval(
      maintenanceUrl.href,
      `${pgHelper}
await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${SMOKE_DB}' AND pid <> pg_backend_pid()");
await client.query("DROP DATABASE IF EXISTS ${SMOKE_DB}");
await client.end();
console.log("ok disposable database dropped");
`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
}

console.log("ok migration execution smoke");
