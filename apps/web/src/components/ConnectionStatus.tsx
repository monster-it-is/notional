import type { ConnectionStatus } from "../realtime/reconnect.ts";

export function ConnectionStatusChip({
  label,
  status,
}: {
  label: string;
  status: ConnectionStatus;
}) {
  const live = status === "ready";
  const text =
    status === "ready"
      ? "live"
      : status === "open_awaiting_hello" || status === "connecting" || status === "reconnecting"
        ? "connecting"
        : status === "protocol_error"
          ? "protocol error"
          : status === "auth_expired"
            ? "session expired"
            : "disconnected";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-secondary">
      <span
        className={`h-2 w-2 rounded-full ${live ? "bg-accent" : "bg-muted"}`}
        aria-hidden="true"
      />
      {label} {text}
    </span>
  );
}
