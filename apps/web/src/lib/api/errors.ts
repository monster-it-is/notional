export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason?: string;
  readonly nextClaimAt?: string;

  constructor(params: {
    status: number;
    code: string;
    reason?: string;
    nextClaimAt?: string;
    message?: string;
  }) {
    super(params.message ?? params.code);
    this.name = "ApiError";
    this.status = params.status;
    this.code = params.code;
    this.reason = params.reason;
    this.nextClaimAt = params.nextClaimAt;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

export function isAccountNotInitialized(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === "ACCOUNT_NOT_INITIALIZED";
}

type ErrorBody = {
  error?: unknown;
  reason?: unknown;
  nextClaimAt?: unknown;
};

export function parseApiError(status: number, body: unknown, fallback: string): ApiError {
  const record = isRecord(body) ? (body as ErrorBody) : {};
  const code = typeof record.error === "string" && record.error.length > 0 ? record.error : fallback;
  const reason = typeof record.reason === "string" ? record.reason : undefined;
  const nextClaimAt = typeof record.nextClaimAt === "string" ? record.nextClaimAt : undefined;

  return new ApiError({
    status,
    code,
    reason,
    nextClaimAt,
    message: formatApiErrorMessage(code, reason),
  });
}

export function formatApiErrorMessage(code: string, reason?: string): string {
  if (reason) {
    return `${code}: ${reason}`;
  }

  return code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
