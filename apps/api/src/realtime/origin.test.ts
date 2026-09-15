import { describe, expect, it } from "vitest";

import { isExactWebOrigin, requestOrigin } from "./origin.js";

describe("websocket origin", () => {
  it("requires an exact WEB_ORIGIN match", () => {
    expect(isExactWebOrigin("http://localhost:5173", "http://localhost:5173")).toBe(true);
    expect(isExactWebOrigin("http://localhost:5173/", "http://localhost:5173")).toBe(false);
    expect(isExactWebOrigin("http://evil.example", "http://localhost:5173")).toBe(false);
    expect(isExactWebOrigin(undefined, "http://localhost:5173")).toBe(false);
    expect(isExactWebOrigin("", "http://localhost:5173")).toBe(false);
  });

  it("reads the Origin header", () => {
    expect(
      requestOrigin({
        headers: { origin: "http://localhost:5173" },
      } as never),
    ).toBe("http://localhost:5173");
    expect(requestOrigin({ headers: {} } as never)).toBeUndefined();
  });
});
