import { DrizzleQueryError } from "drizzle-orm/errors";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { runMigrationCli } from "./migrate-cli.js";
import { migrationsFolder } from "./migrate.js";
import { endTestPool } from "./test.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("compiled migrator", () => {
  afterAll(async () => {
    await endTestPool();
  });

  it("resolves checked-in SQL next to the package dist output", () => {
    const folder = migrationsFolder();
    expect(existsSync(folder)).toBe(true);
    expect(existsSync(`${folder}/0000_auth.sql`)).toBe(true);
    expect(existsSync(`${folder}/meta/_journal.json`)).toBe(true);
  });

  it("keeps production migration execution on a dedicated entry without a main-module guard", () => {
    const library = readFileSync(resolve(here, "migrate.ts"), "utf8");
    const entry = readFileSync(resolve(here, "migrate-entry.ts"), "utf8");
    const docker = readFileSync(
      resolve(here, "../../../apps/api/docker-entrypoint.sh"),
      "utf8",
    );

    expect(library).not.toMatch(/process\.argv/);
    expect(library).not.toMatch(/import\.meta\.url ===/);
    expect(library).not.toMatch(/from "\.\/client\.js"/);
    expect(library).toMatch(/migrationDatabaseUrl\(/);
    expect(library).toMatch(/connectionString:\s*migrationDatabaseUrl\(/);
    expect(entry).toMatch(/runMigrationCli/);
    expect(entry).toMatch(/runMigrations/);
    expect(entry).toMatch(/closeMigrationPool/);
    expect(entry).not.toMatch(/process\.argv/);
    expect(entry).not.toMatch(/import\.meta\.url/);
    expect(entry).not.toMatch(/from "\.\/client\.js"/);
    expect(entry).not.toMatch(/\bclosePool\b/);
    expect(docker).toContain(
      "node node_modules/@notional/db/dist/migrate-entry.js",
    );
    expect(docker).toContain("unset MIGRATION_DATABASE_URL");
    expect(docker).not.toContain("dist/migrate.js");
    expect(docker.indexOf("unset MIGRATION_DATABASE_URL")).toBeGreaterThan(
      docker.indexOf("migrate-entry.js"),
    );
    expect(docker.indexOf("exec node dist/server.js")).toBeGreaterThan(
      docker.indexOf("unset MIGRATION_DATABASE_URL"),
    );
  });
});

describe("migration CLI lifecycle", () => {
  it("closes the pool after a successful migration", async () => {
    const events: string[] = [];
    const code = await runMigrationCli({
      async run() {
        events.push("run");
      },
      async close() {
        events.push("close");
      },
      writeError(message) {
        events.push(`err:${message}`);
      },
    });

    expect(code).toBe(0);
    expect(events).toEqual(["run", "close"]);
  });

  it("closes the pool after a failed migration and keeps a non-zero exit", async () => {
    const events: string[] = [];
    const code = await runMigrationCli({
      async run() {
        events.push("run");
        throw withStack(new Error("migration boom"));
      },
      async close() {
        events.push("close");
      },
      writeError(message) {
        events.push(`err:${message}`);
      },
    });

    expect(code).toBe(1);
    expect(events).toEqual([
      "run",
      "close",
      `err:${diagnostic("Error", "migration boom")}`,
    ]);
  });

  it("returns non-zero when pool close fails after a successful migration", async () => {
    const events: string[] = [];
    const code = await runMigrationCli({
      async run() {
        events.push("run");
      },
      async close() {
        throw withStack(new Error("close boom"));
      },
      writeError(message) {
        events.push(message);
      },
    });

    expect(code).toBe(1);
    expect(events).toEqual(["run", diagnostic("Error", "close boom")]);
  });

  it("preserves the original migration error when pool close also fails", async () => {
    const events: string[] = [];
    const code = await runMigrationCli({
      async run() {
        throw withStack(new Error("migration boom"));
      },
      async close() {
        throw withStack(new Error("close boom"));
      },
      writeError(message) {
        events.push(message);
      },
    });

    expect(code).toBe(1);
    expect(events).toEqual([
      diagnostic("Error", "close boom"),
      diagnostic("Error", "migration boom"),
    ]);
  });

  it("logs a DrizzleQueryError cause without connection secrets", async () => {
    const events: string[] = [];
    const cause = new DatabaseError(
      "MIGRATION_DATABASE_URL=postgres://migrator:super-secret@db.internal:5432/notional password=super-secret connection failed at postgres://migrator:super-secret@db.internal:5432/notional",
      "28P01",
    );
    const failure = new DrizzleQueryError(
      'CREATE SCHEMA IF NOT EXISTS "drizzle"',
      [],
      cause,
    );
    failure.stack = "DrizzleQueryError stack";
    Object.assign(failure, {
      connectionString: "postgres://migrator:super-secret@db.internal/notional",
    });

    const code = await runMigrationCli({
      async run() {
        throw failure;
      },
      async close() {
        return undefined;
      },
      writeError(message) {
        events.push(message);
      },
    });

    expect(code).toBe(1);
    expect(events).toEqual([
      [
        "name: DrizzleQueryError",
        'message: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"',
        "params: ",
        "cause:",
        "  name: DatabaseError",
        "  message: [redacted] [redacted] connection failed at [redacted]",
        "  code: 28P01",
        "stack: DrizzleQueryError stack",
        "",
      ].join("\n"),
    ]);
    expect(events.join("\n")).not.toContain("super-secret");
    expect(events.join("\n")).not.toContain("postgres://");
    expect(events.join("\n")).not.toContain("connectionString");
    expect(events.join("\n")).not.toContain("migrator");
    expect(events.join("\n")).not.toContain("MIGRATION_DATABASE_URL=");
  });

  it("stops when an error cause points at itself", async () => {
    const events: string[] = [];
    const error = withStack(new Error("loop"));
    error.cause = error;

    const code = await runMigrationCli({
      async run() {
        throw error;
      },
      async close() {
        return undefined;
      },
      writeError(message) {
        events.push(message);
      },
    });

    expect(code).toBe(1);
    expect(events).toEqual([
      "name: Error\nmessage: loop\ncause:\n  name: (circular)\nstack: Error: loop\n",
    ]);
  });
});

function withStack(error: Error): Error {
  error.stack = `${error.name}: ${error.message}`;
  return error;
}

function diagnostic(name: string, message: string): string {
  return `name: ${name}\nmessage: ${message}\nstack: ${name}: ${message}\n`;
}

class DatabaseError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
