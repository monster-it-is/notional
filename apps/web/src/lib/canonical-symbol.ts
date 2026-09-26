export const CANONICAL_SYMBOL = /^[A-Z0-9]+$/;

export function normalizeSymbolInput(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isCanonicalSymbol(value: string): boolean {
  return CANONICAL_SYMBOL.test(value);
}

export function isBlockedHistorySymbol(value: string): boolean {
  return value.length > 0 && !isCanonicalSymbol(value);
}
