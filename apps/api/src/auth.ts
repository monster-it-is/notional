import { account, db, session, user, verification } from "@notional/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { env } from "./env.js";

export const AUTH_SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

export type AuthCookieAttributes = {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
};

export function authCookieSettings(canonicalAuthUrl: string): {
  useSecureCookies: boolean;
  defaultCookieAttributes: AuthCookieAttributes;
  expiresIn: number;
} {
  const secure = new URL(canonicalAuthUrl).protocol === "https:";
  return {
    useSecureCookies: secure,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
    },
    expiresIn: AUTH_SESSION_EXPIRES_IN_SECONDS,
  };
}

const cookies = authCookieSettings(env.BETTER_AUTH_URL);

export const auth = betterAuth({
  appName: "Notional",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user,
      session,
      account,
      verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: cookies.expiresIn,
  },
  advanced: {
    useSecureCookies: cookies.useSecureCookies,
    defaultCookieAttributes: cookies.defaultCookieAttributes,
    database: {
      generateId: "uuid",
    },
  },
});
