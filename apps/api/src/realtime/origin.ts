import type { FastifyRequest } from "fastify";

export function requestOrigin(request: FastifyRequest): string | undefined {
  const origin = request.headers.origin;

  if (typeof origin !== "string" || origin === "") {
    return undefined;
  }

  return origin;
}

export function isExactWebOrigin(origin: string | undefined, webOrigin: string): boolean {
  return origin === webOrigin;
}
