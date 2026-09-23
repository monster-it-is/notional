import { describe, expect, it } from "vitest";

import { unknownErrorDiagnostic, unknownErrorLogFields } from "./logging.js";

const POOL_ACQUIRE_TIMEOUT_MESSAGE = "timeout exceeded when trying to connect";

describe("unknownErrorDiagnostic", () => {
  it("keeps only name and a conservative code and drops secret-bearing fields", () => {
    const error = new Error(
      "select 1 from postgresql://user:password@host/db BETTER_AUTH_SECRET=/internal/private/path",
    );
    error.name = "ProbeError";
    Object.assign(error, {
      code: "PROBE_CODE",
      password: "password-marker",
      stack: "stack at /internal/private/path",
    });

    expect(unknownErrorDiagnostic(error)).toEqual({
      name: "ProbeError",
      code: "PROBE_CODE",
      messageKind: "generic",
    });
    expect(unknownErrorLogFields(error)).toEqual({
      err: { name: "ProbeError", code: "PROBE_CODE", messageKind: "generic" },
    });
    expect(JSON.stringify(unknownErrorLogFields(error))).not.toContain("postgresql://");
    expect(JSON.stringify(unknownErrorLogFields(error))).not.toContain("password-marker");
    expect(JSON.stringify(unknownErrorLogFields(error))).not.toContain("BETTER_AUTH_SECRET");
    expect(JSON.stringify(unknownErrorLogFields(error))).not.toContain("/internal/private/path");
    expect(JSON.stringify(unknownErrorLogFields(error))).not.toContain("select 1");
  });

  it("omits unsafe codes and non-Error values", () => {
    expect(
      unknownErrorDiagnostic({
        code: "postgresql://user:password@host/db",
      }),
    ).toEqual({ name: "UnknownError", messageKind: "generic" });
    expect(unknownErrorDiagnostic("raw-string")).toEqual({
      name: "UnknownError",
      messageKind: "generic",
    });
  });

  it("keeps TypeError and ECONNREFUSED and replaces unsafe Error.name", () => {
    expect(unknownErrorDiagnostic(new TypeError("ignored"))).toEqual({
      name: "TypeError",
      messageKind: "generic",
    });

    const refused = new Error("connection failed");
    Object.assign(refused, { code: "ECONNREFUSED" });
    expect(unknownErrorDiagnostic(refused)).toEqual({
      name: "Error",
      code: "ECONNREFUSED",
      messageKind: "generic",
    });

    const unsafeNames = [
      "postgresql://user:password@host/db",
      "BETTER_AUTH_SECRET=replace-me",
      "/internal/private/path",
      "A".repeat(65),
      "Error\nwith-newline",
    ];

    for (const unsafeName of unsafeNames) {
      const error = new Error("select 1 from secret_table");
      error.name = unsafeName;
      const diagnostic = unknownErrorDiagnostic(error);
      const serialized = JSON.stringify(unknownErrorLogFields(error));
      expect(diagnostic).toEqual({ name: "Error", messageKind: "generic" });
      expect(serialized).not.toContain(unsafeName);
      expect(serialized).not.toContain("postgresql://");
      expect(serialized).not.toContain("password@host");
      expect(serialized).not.toContain("BETTER_AUTH_SECRET=");
      expect(serialized).not.toContain("/internal/private/path");
      expect(serialized).not.toContain("select 1");
      expect(serialized).not.toContain("\n");
    }
  });

  it("classifies an exact pg pool acquire timeout without emitting the raw message", () => {
    const error = new Error(POOL_ACQUIRE_TIMEOUT_MESSAGE);
    const diagnostic = unknownErrorDiagnostic(error);
    const serialized = JSON.stringify(unknownErrorLogFields(error));

    expect(diagnostic).toEqual({ name: "Error", messageKind: "pool_acquire_timeout" });
    expect(diagnostic).not.toHaveProperty("message");
    expect(serialized).not.toContain(POOL_ACQUIRE_TIMEOUT_MESSAGE);
    expect(serialized).not.toContain("timeout exceeded");
  });

  it("does not treat a similar but inexact pool timeout message as pool_acquire_timeout", () => {
    expect(unknownErrorDiagnostic(new Error(`${POOL_ACQUIRE_TIMEOUT_MESSAGE} now`))).toEqual({
      name: "Error",
      messageKind: "generic",
    });
  });

  it("classifies a wrapped pg pool acquire timeout from one cause level", () => {
    const error = new Error("wrapper");
    error.cause = new Error(POOL_ACQUIRE_TIMEOUT_MESSAGE);
    const diagnostic = unknownErrorDiagnostic(error);
    const serialized = JSON.stringify(unknownErrorLogFields(error));

    expect(diagnostic).toEqual({
      name: "Error",
      causeName: "Error",
      messageKind: "pool_acquire_timeout",
    });
    expect(serialized).not.toContain(POOL_ACQUIRE_TIMEOUT_MESSAGE);
    expect(serialized).not.toContain("wrapper");
  });

  it("surfaces a Drizzle-style nested cause code without SQL, params, or secrets", () => {
    const cause = new Error(
      "MIGRATION_DATABASE_URL=postgres://migrator:super-secret@db.internal:5432/notional password=super-secret connection failed at postgres://migrator:super-secret@db.internal:5432/notional",
    );
    cause.name = "DatabaseError";
    Object.assign(cause, { code: "28P01" });
    const error = new Error(
      'Failed query: SELECT * FROM trade_order WHERE status = $1\nparams: ["OPEN"]',
    );
    error.name = "DrizzleQueryError";
    error.cause = cause;
    Object.assign(error, {
      query: "SELECT * FROM trade_order",
      params: ["OPEN", "postgresql://user:password@host/db"],
    });

    const diagnostic = unknownErrorDiagnostic(error);
    const serialized = JSON.stringify(unknownErrorLogFields(error));

    expect(diagnostic).toEqual({
      name: "DrizzleQueryError",
      causeName: "DatabaseError",
      causeCode: "28P01",
      messageKind: "generic",
    });
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("migrator");
    expect(serialized).not.toContain("MIGRATION_DATABASE_URL");
    expect(serialized).not.toContain("DATABASE_URL");
    expect(serialized).not.toContain("password=");
    expect(serialized).not.toContain("Failed query");
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("trade_order");
    expect(serialized).not.toContain("params");
    expect(serialized).not.toContain("OPEN");
  });

  it("does not serialize a string cause or an unsafe nested cause name/code", () => {
    const stringCause = new Error("outer");
    stringCause.cause = "postgresql://user:password@host/db";
    expect(unknownErrorDiagnostic(stringCause)).toEqual({
      name: "Error",
      messageKind: "generic",
    });
    expect(JSON.stringify(unknownErrorLogFields(stringCause))).not.toContain("postgresql://");
    expect(JSON.stringify(unknownErrorLogFields(stringCause))).not.toContain("password@host");

    const unsafeCause = new Error("outer");
    const nested = new Error("select 1 from secret_table");
    nested.name = "postgresql://user:password@host/db";
    Object.assign(nested, { code: "postgres://migrator:super-secret@db/notional" });
    unsafeCause.cause = nested;

    const diagnostic = unknownErrorDiagnostic(unsafeCause);
    const serialized = JSON.stringify(unknownErrorLogFields(unsafeCause));
    expect(diagnostic).toEqual({
      name: "Error",
      causeName: "Error",
      messageKind: "generic",
    });
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("select 1");
  });

  it("does not walk cause.cause", () => {
    const inner = new Error("password=super-secret");
    inner.name = "DatabaseError";
    Object.assign(inner, { code: "28P01" });
    const mid = new Error("Failed query: SELECT 1");
    mid.name = "DrizzleQueryError";
    mid.cause = inner;
    const outer = new Error("outer");
    outer.name = "WrapperError";
    outer.cause = mid;

    expect(unknownErrorDiagnostic(outer)).toEqual({
      name: "WrapperError",
      causeName: "DrizzleQueryError",
      messageKind: "generic",
    });
  });
});
