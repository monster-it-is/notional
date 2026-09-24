import type { InstrumentResponse } from "@notional/contracts";

import { FormField } from "./ui/FormField.tsx";
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
    <FormField label="Instrument">
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
    </FormField>
  );
}
