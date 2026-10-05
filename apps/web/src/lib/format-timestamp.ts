export function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function formatEpochMsUtc(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }

  const date = new Date(epochMs);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  try {
    return formatTimestamp(date.toISOString());
  } catch {
    return "—";
  }
}
