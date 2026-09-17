import { describe, expect, it } from "vitest";

import { unknownErrorDiagnostic, unknownErrorLogFields } from "./logging.js";

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

    expect(unknownErrorDiagnostic(error)).toEqual({ name: "ProbeError", code: "PROBE_CODE" });
    expect(unknownErrorLogFields(error)).toEqual({
      err: { name: "ProbeError", code: "PROBE_CODE" },
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
    ).toEqual({ name: "UnknownError" });
    expect(unknownErrorDiagnostic("raw-string")).toEqual({ name: "UnknownError" });
  });

  it("keeps TypeError and ECONNREFUSED and replaces unsafe Error.name", () => {
    expect(unknownErrorDiagnostic(new TypeError("ignored"))).toEqual({ name: "TypeError" });

    const refused = new Error("connection failed");
    Object.assign(refused, { code: "ECONNREFUSED" });
    expect(unknownErrorDiagnostic(refused)).toEqual({ name: "Error", code: "ECONNREFUSED" });

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
      expect(diagnostic).toEqual({ name: "Error" });
      expect(serialized).not.toContain(unsafeName);
      expect(serialized).not.toContain("postgresql://");
      expect(serialized).not.toContain("password@host");
      expect(serialized).not.toContain("BETTER_AUTH_SECRET=");
      expect(serialized).not.toContain("/internal/private/path");
      expect(serialized).not.toContain("select 1");
      expect(serialized).not.toContain("\n");
    }
  });
});
