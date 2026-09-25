const SYNTHETIC_ORIGIN = "https://notional.invalid";

export function getSafeInternalPath(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, SYNTHETIC_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.origin !== SYNTHETIC_ORIGIN) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
