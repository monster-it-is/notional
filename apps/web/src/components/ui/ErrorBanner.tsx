import { formatApiErrorMessage, isApiError } from "../../lib/api/errors.ts";

export function ErrorBanner({ error }: { error: unknown }) {
  const message = isApiError(error)
    ? formatApiErrorMessage(error.code, error.reason)
    : error instanceof Error
      ? error.message
      : "Something went wrong";

  return (
    <div role="alert" className="rounded-md border border-app-danger/40 bg-app-danger/10 px-3 py-2 text-sm text-app-danger">
      {message}
    </div>
  );
}
