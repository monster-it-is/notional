import { describe, expect, it } from "vitest";

import {
  applicationDatabaseUrl,
  migrationDatabaseUrl,
} from "./database-url.js";

describe("applicationDatabaseUrl", () => {
  it("reads DATABASE_URL and ignores MIGRATION_DATABASE_URL", () => {
    expect(
      applicationDatabaseUrl({
        DATABASE_URL: "postgresql://app@localhost/notional",
        MIGRATION_DATABASE_URL: "postgresql://admin@localhost/notional",
      }),
    ).toBe("postgresql://app@localhost/notional");
  });

  it("rejects a missing or empty DATABASE_URL", () => {
    expect(() => applicationDatabaseUrl({})).toThrow(
      "DATABASE_URL is not defined",
    );
    expect(() =>
      applicationDatabaseUrl({
        DATABASE_URL: "",
        MIGRATION_DATABASE_URL: "postgresql://admin@localhost/notional",
      }),
    ).toThrow("DATABASE_URL is not defined");
  });
});

describe("migrationDatabaseUrl", () => {
  it("uses MIGRATION_DATABASE_URL when supplied", () => {
    expect(
      migrationDatabaseUrl({
        DATABASE_URL: "postgresql://app@localhost/notional",
        MIGRATION_DATABASE_URL: "postgresql://admin@localhost/notional",
      }),
    ).toBe("postgresql://admin@localhost/notional");
  });

  it("falls back to DATABASE_URL when MIGRATION_DATABASE_URL is absent", () => {
    expect(
      migrationDatabaseUrl({
        DATABASE_URL: "postgresql://app@localhost/notional",
      }),
    ).toBe("postgresql://app@localhost/notional");
    expect(
      migrationDatabaseUrl({
        DATABASE_URL: "postgresql://app@localhost/notional",
        MIGRATION_DATABASE_URL: "",
      }),
    ).toBe("postgresql://app@localhost/notional");
  });
});
