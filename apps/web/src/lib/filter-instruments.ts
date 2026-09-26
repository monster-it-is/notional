import type { InstrumentResponse } from "@notional/contracts";

export function filterInstruments(
  instruments: readonly InstrumentResponse[],
  query: string,
): readonly InstrumentResponse[] {
  const needle = query.trim().toLowerCase();

  if (needle.length === 0) {
    return instruments;
  }

  return instruments.filter((instrument) => {
    return (
      instrument.symbol.toLowerCase().includes(needle) ||
      instrument.baseAsset.toLowerCase().includes(needle)
    );
  });
}
