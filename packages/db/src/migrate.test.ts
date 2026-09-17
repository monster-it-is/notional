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
    const docker = readFileSync(resolve(here, "../../../apps/api/docker-entrypoint.sh"), "utf8");

    expect(library).not.toMatch(/process\.argv/);
    expect(library).not.toMatch(/import\.meta\.url ===/);
    expect(entry).toMatch(/runMigrationCli/);
    expect(entry).toMatch(/runMigrations/);
    expect(entry).not.toMatch(/process\.argv/);
    expect(entry).not.toMatch(/import\.meta\.url/);
    expect(docker).toContain("node node_modules/@notional/db/dist/migrate-entry.js");
    expect(docker).not.toContain("dist/migrate.js");
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
        throw new Error("migration boom");
      },
      async close() {
        events.push("close");
      },
      writeError(message) {
        events.push(`err:${message}`);
      },
    });

    expect(code).toBe(1);
    expect(events).toEqual(["run", "close", "err:migration boom\n"]);
  });

  it("returns non-zero when pool close fails after a successful migration", async () => {
    const events: string[] = [];
    const code = await runMigrationCli({
      async run() {
        events.push("run");
      },
      async close() {
        throw new Error("close boom");
      },
      writeError(message) {
        events.push(message);
      },
    });

    expect(code).toBe(1);
    expect(events).toEqual(["run", "close boom\n"]);
  });

  it("preserves the original migration error when pool close also fails", async () => {
    const events: string[] = [];
    const code = await runMigrationCli({
      async run() {
        throw new Error("migration boom");
      },
      async close() {
        throw new Error("close boom");
      },
      writeError(message) {
        events.push(message);
      },
    });

    expect(code).toBe(1);
    expect(events).toEqual(["close boom\n", "migration boom\n"]);
  });
});
