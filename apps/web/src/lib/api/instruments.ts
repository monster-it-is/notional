import type { InstrumentListResponse } from "@notional/contracts";

import { apiRequest } from "./client.ts";

export function listInstruments(): Promise<InstrumentListResponse> {
  return apiRequest<InstrumentListResponse>("/api/instruments");
}
