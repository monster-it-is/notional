import { formatApiErrorMessage, isApiError } from "../../lib/api/errors.ts";

export function ErrorBanner({ error }: { error: unknown }) {
  const message = isApiError(error)
    ? formatApiErrorMessage(error.code, error.reason)
    : error instanceof Error
      ? error.message
      : "Something went wrong";

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-background px-3 py-2 text-sm text-warning"
    >
      <WarningIcon />
      <span>{message}</span>
    </div>
  );
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="mt-0.5 size-4 shrink-0"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M8.87 2.4a1 1 0 0 0-1.74 0L1.3 12.2A1 1 0 0 0 2.17 13.7h11.66a1 1 0 0 0 .87-1.5L8.87 2.4ZM8 6.2c.35 0 .62.28.6.63l-.18 3.1a.42.42 0 0 1-.84 0l-.18-3.1c-.02-.35.25-.63.6-.63Zm0 6.05a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4Z" />
    </svg>
  );
}
