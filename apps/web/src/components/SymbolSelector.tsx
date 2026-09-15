import type { InstrumentResponse } from "@notional/contracts";

import { Select } from "./ui/Select.tsx";

export function SymbolSelector({
  instruments,
  value,
  onChange,
}: {
  instruments: InstrumentResponse[];
  value: string | null;
  onChange: (symbol: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-app-text">Instrument</span>
      <Select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Instrument"
      >
        {instruments.length === 0 ? <option value="">No instruments</option> : null}
        {instruments.map((instrument) => (
          <option key={instrument.symbol} value={instrument.symbol}>
            {instrument.symbol}
          </option>
        ))}
      </Select>
    </label>
  );
}
