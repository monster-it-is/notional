import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DUMMY_DATABASE_URL = "postgresql://smoke:smoke@127.0.0.1:1/notional_smoke_unused";
const API_TEST_ONLY = [
  "dist/market-data/test-helpers.js",
  "dist/market-data/exchange-info-fixtures.js",
  "dist/realtime/test-helpers.js",
  "dist/services/funding-test-fixtures.js",
];

const targetArg = process.argv[2];
if (!targetArg) {
  throw new Error("usage: node scripts/production-resolution-smoke.mjs <deploy-dir>");
}

const target = resolve(targetArg);
const apiPkg = resolve(target, "package.json");
if (!existsSync(apiPkg)) {
  throw new Error(`missing package.json in ${target}`);
}

const env = { ...process.env, DATABASE_URL: DUMMY_DATABASE_URL };
for (const key of Object.keys(env)) {
  if (key.toUpperCase() === "NODE_OPTIONS") {
    delete env[key];
  }
}

const inner = `
import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const target = ${JSON.stringify(target)};
process.env.DATABASE_URL = ${JSON.stringify(DUMMY_DATABASE_URL)};

function assertInsideTarget(spec, filePath) {
  const rel = relative(target, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(spec + " resolved outside the deploy artifact: " + filePath);
  }
}

function assertDistJs(spec, filePath) {
  assertInsideTarget(spec, filePath);
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
    throw new Error(spec + " resolved to TypeScript source: " + filePath);
  }
  if (!filePath.split(/[/\\\\]/).includes("dist")) {
    throw new Error(spec + " resolved to " + filePath + ", expected dist JS");
  }
}

function packageRootFromDistIndex(filePath) {
  return dirname(dirname(filePath));
}

function listFiles(dir) {
  const names = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      names.push(...listFiles(resolvePath(dir, entry.name)));
    } else {
      names.push(entry.name);
    }
  }
  return names;
}

for (const spec of ["@notional/contracts", "@notional/trading"]) {
  const url = import.meta.resolve(spec);
  const filePath = fileURLToPath(url);
  assertDistJs(spec, filePath);
  await import(url);
  if (existsSync(resolvePath(packageRootFromDistIndex(filePath), "src"))) {
    throw new Error(spec + " production artifact contains src/");
  }
  console.log("ok import " + spec);
}

const dbUrl = import.meta.resolve("@notional/db");
const dbPath = fileURLToPath(dbUrl);
assertDistJs("@notional/db", dbPath);
const db = await import(dbUrl);
await db.closePool();
console.log("ok import @notional/db");

const dbRoot = packageRootFromDistIndex(dbPath);
if (existsSync(resolvePath(dbRoot, "src"))) {
  throw new Error("production @notional/db artifact contains src/");
}

let testExportResolved = false;
try {
  await import("@notional/db/test");
  testExportResolved = true;
} catch (error) {
  if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
    throw error;
  }
  console.log("ok @notional/db/test ERR_PACKAGE_PATH_NOT_EXPORTED");
}
if (testExportResolved) {
  throw new Error("@notional/db/test must not resolve without the development condition");
}

try {
  const tsxUrl = import.meta.resolve("tsx");
  const tsxPath = fileURLToPath(tsxUrl);
  const rel = relative(target, tsxPath);
  if (!(rel.startsWith("..") || isAbsolute(rel))) {
    throw new Error("tsx resolved inside the deploy artifact: " + tsxPath);
  }
  console.log("ok tsx is not in the deploy artifact");
} catch (error) {
  const missing = error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND";
  if (!missing) {
    throw error;
  }
  console.log("ok tsx is unavailable");
}

const drizzle = resolvePath(dbRoot, "drizzle");
if (!existsSync(resolvePath(drizzle, "0000_auth.sql"))) {
  throw new Error("missing drizzle SQL at " + drizzle);
}
if (!existsSync(resolvePath(drizzle, "meta/_journal.json"))) {
  throw new Error("missing drizzle journal at " + drizzle);
}
console.log("ok drizzle migrations");

const dbDist = resolvePath(dbRoot, "dist");
if (!existsSync(resolvePath(dbDist, "migrate-entry.js"))) {
  throw new Error("missing compiled migration entry at " + resolvePath(dbDist, "migrate-entry.js"));
}
console.log("ok migrate-entry.js");

for (const name of listFiles(dbDist)) {
  if (
    name === "test.js" ||
    name === "reset-test-tables.js" ||
    name.endsWith(".test.js") ||
    name.includes("test-helpers")
  ) {
    throw new Error("production db dist contains " + name);
  }
}
console.log("ok db test helpers absent");
`;

const spawned = spawnSync(process.execPath, ["--input-type=module", "--eval", inner], {
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
  throw new Error(`production artifact ESM import smoke failed with status ${spawned.status ?? "null"}`);
}

if (!existsSync(resolve(target, "dist/server.js"))) {
  throw new Error("missing dist/server.js in the deploy artifact");
}
console.log("ok dist/server.js");

for (const rel of API_TEST_ONLY) {
  if (existsSync(resolve(target, rel))) {
    throw new Error(`production artifact contains test-only helper ${rel}`);
  }
}
console.log("ok API test-only helpers absent");

const dockerEntrypoint = resolve(target, "docker-entrypoint.sh");
if (!existsSync(dockerEntrypoint)) {
  throw new Error("missing docker-entrypoint.sh in the deploy artifact");
}
const entrypointText = readFileSync(dockerEntrypoint, "utf8");
if (!entrypointText.includes("node node_modules/@notional/db/dist/migrate-entry.js")) {
  throw new Error("docker-entrypoint.sh must execute dist/migrate-entry.js");
}
if (entrypointText.includes("dist/migrate.js")) {
  throw new Error("docker-entrypoint.sh must not execute dist/migrate.js");
}
console.log("ok docker-entrypoint migration executable");
console.log("ok production artifact smoke");
