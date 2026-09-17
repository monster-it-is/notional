import type { FastifyInstance, FastifyRequest } from "fastify";

export type RateLimitPolicy = {
  signupMax: number;
  signupWindowMs: number;
  signinMax: number;
  signinWindowMs: number;
  otherAuthMax: number;
  otherAuthWindowMs: number;
  ordersMax: number;
  ordersWindowMs: number;
  cancelMax: number;
  cancelWindowMs: number;
  faucetMax: number;
  faucetWindowMs: number;
  initializeMax: number;
  initializeWindowMs: number;
  marginMax: number;
  marginWindowMs: number;
  readsMax: number;
  readsWindowMs: number;
  wsMax: number;
  wsWindowMs: number;
};

export type UserLimitKind = "orders" | "cancel" | "faucet" | "initialize" | "margin" | "reads";

export const defaultRateLimitPolicy: RateLimitPolicy = {
  signupMax: 5,
  signupWindowMs: 15 * 60_000,
  signinMax: 10,
  signinWindowMs: 15 * 60_000,
  otherAuthMax: 60,
  otherAuthWindowMs: 60_000,
  ordersMax: 30,
  ordersWindowMs: 60_000,
  cancelMax: 60,
  cancelWindowMs: 60_000,
  faucetMax: 5,
  faucetWindowMs: 60 * 60_000,
  initializeMax: 10,
  initializeWindowMs: 60 * 60_000,
  marginMax: 20,
  marginWindowMs: 60_000,
  readsMax: 120,
  readsWindowMs: 60_000,
  wsMax: 20,
  wsWindowMs: 60_000,
};

const userLimitKeys: Record<UserLimitKind, { max: keyof RateLimitPolicy; window: keyof RateLimitPolicy }> = {
  orders: { max: "ordersMax", window: "ordersWindowMs" },
  cancel: { max: "cancelMax", window: "cancelWindowMs" },
  faucet: { max: "faucetMax", window: "faucetWindowMs" },
  initialize: { max: "initializeMax", window: "initializeWindowMs" },
  margin: { max: "marginMax", window: "marginWindowMs" },
  reads: { max: "readsMax", window: "readsWindowMs" },
};

let policy: RateLimitPolicy = { ...defaultRateLimitPolicy };

export function getRateLimitPolicy(): RateLimitPolicy {
  return policy;
}

export function setRateLimitPolicyForTests(next: Partial<RateLimitPolicy>): void {
  policy = { ...policy, ...next };
}

export function resetRateLimitPolicyForTests(): void {
  policy = { ...defaultRateLimitPolicy };
}

const RATE_LIMITED = { statusCode: 429, error: "RATE_LIMITED" };

function authPath(request: FastifyRequest): string {
  return request.url.split("?")[0] ?? request.url;
}

export function createAuthRateLimit(app: FastifyInstance) {
  return app.rateLimit({
    keyGenerator: (request) => {
      const path = authPath(request);
      if (path === "/api/auth/sign-up/email") {
        return `signup:${request.ip}`;
      }
      if (path === "/api/auth/sign-in/email") {
        return `signin:${request.ip}`;
      }
      return `auth:${request.ip}`;
    },
    max: (request) => {
      const path = authPath(request);
      if (path === "/api/auth/sign-up/email") {
        return policy.signupMax;
      }
      if (path === "/api/auth/sign-in/email") {
        return policy.signinMax;
      }
      return policy.otherAuthMax;
    },
    timeWindow: (request) => {
      const path = authPath(request);
      if (path === "/api/auth/sign-up/email") {
        return policy.signupWindowMs;
      }
      if (path === "/api/auth/sign-in/email") {
        return policy.signinWindowMs;
      }
      return policy.otherAuthWindowMs;
    },
    errorResponseBuilder: () => RATE_LIMITED,
  });
}

export function createUserRateLimit(app: FastifyInstance, kind: UserLimitKind) {
  const keys = userLimitKeys[kind];
  return app.rateLimit({
    keyGenerator: (request) => {
      const id = request.auth?.user.id;
      if (!id) {
        throw new Error("authenticated rate limit used before requireAuth");
      }
      return `user:${id}`;
    },
    max: () => Number(policy[keys.max]),
    timeWindow: () => Number(policy[keys.window]),
    errorResponseBuilder: () => RATE_LIMITED,
  });
}

export function createWsRateLimit(app: FastifyInstance) {
  return app.rateLimit({
    keyGenerator: (request) => `ws:${request.ip}`,
    max: () => policy.wsMax,
    timeWindow: () => policy.wsWindowMs,
    errorResponseBuilder: () => RATE_LIMITED,
  });
}
