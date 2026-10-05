export function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

const UTC_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

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

/**
 * Compact UTC clock for market summary. Same UTC calendar day omits the date.
 */
export function formatCompactEpochMsUtc(epochMs: number, nowMs = Date.now()): string {
  if (!Number.isFinite(epochMs) || !Number.isFinite(nowMs)) {
    return "—";
  }

  const date = new Date(epochMs);
  const now = new Date(nowMs);

  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) {
    return "—";
  }

  const time = `${padUtc(date.getUTCHours())}:${padUtc(date.getUTCMinutes())} UTC`;
  const sameUtcDate =
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate();

  if (sameUtcDate) {
    return time;
  }

  const month = UTC_MONTHS[date.getUTCMonth()];
  if (month === undefined) {
    return "—";
  }

  return `${padUtc(date.getUTCDate())} ${month} · ${time}`;
}

function padUtc(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
