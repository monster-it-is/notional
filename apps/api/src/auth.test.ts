import { describe, expect, it } from "vitest";

import { AUTH_SESSION_EXPIRES_IN_SECONDS, authCookieSettings } from "./auth.js";
import {
  authHandlerHeaders,
  authHandlerUrl,
  createAuthHandlerRequest,
} from "./auth-plugin.js";
import { env } from "./env.js";

describe("auth cookie settings", () => {
  it("is host-only HttpOnly Lax Path=/ and Secure only for https", () => {
    const http = authCookieSettings("http://localhost:3000");
    expect(http.expiresIn).toBe(AUTH_SESSION_EXPIRES_IN_SECONDS);
    expect(http.useSecureCookies).toBe(false);
    expect(http.defaultCookieAttributes).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
    expect(http.defaultCookieAttributes).not.toHaveProperty("domain");

    const https = authCookieSettings("https://api.example.com");
    expect(https.useSecureCookies).toBe(true);
    expect(https.defaultCookieAttributes.httpOnly).toBe(true);
    expect(https.defaultCookieAttributes.sameSite).toBe("lax");
    expect(https.defaultCookieAttributes.path).toBe("/");
    expect(https.defaultCookieAttributes.secure).toBe(true);
    expect(https.defaultCookieAttributes).not.toHaveProperty("domain");
  });
});

describe("auth handler request reconstruction", () => {
  it("keeps BETTER_AUTH_URL as authority for relative and absolute targets", () => {
    const relative = authHandlerUrl("/api/auth/ok?foo=1", "http://localhost:3000");
    expect(relative.href).toBe("http://localhost:3000/api/auth/ok?foo=1");
    expect(relative.origin).toBe("http://localhost:3000");

    const absolute = authHandlerUrl(
      "http://evil.example/api/auth/sign-up/email?callbackURL=https://evil.example",
      "https://api.example.com",
    );
    expect(absolute.origin).toBe("https://api.example.com");
    expect(absolute.pathname).toBe("/api/auth/sign-up/email");
    expect(absolute.search).toBe("?callbackURL=https://evil.example");
  });

  it("strips Host and forwarded authority headers but keeps Origin and Cookie", () => {
    const headers = authHandlerHeaders({
      host: "evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
      forwarded: "host=evil.example;proto=https",
      origin: "http://localhost:5173",
      cookie: "better-auth.session_token=abc",
    });

    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("x-forwarded-proto")).toBeNull();
    expect(headers.get("forwarded")).toBeNull();
    expect(headers.get("origin")).toBe("http://localhost:5173");
    expect(headers.get("cookie")).toBe("better-auth.session_token=abc");
  });

  it("builds a Request that ignores spoofed Host and absolute-form targets", () => {
    const request = createAuthHandlerRequest(
      {
        url: "https://spoofed.example/api/auth/ok?x=1",
        method: "POST",
        headers: {
          host: "spoofed.example",
          "x-forwarded-host": "spoofed.example",
          origin: env.WEB_ORIGIN,
        },
        body: { hello: "world" },
      },
      env.BETTER_AUTH_URL,
    );

    expect(request.url).toBe(`${env.BETTER_AUTH_URL}/api/auth/ok?x=1`);
    expect(new URL(request.url).origin).toBe(env.BETTER_AUTH_URL);
    expect(request.headers.get("host")).toBeNull();
    expect(request.headers.get("x-forwarded-host")).toBeNull();
    expect(request.headers.get("origin")).toBe(env.WEB_ORIGIN);
  });
});
