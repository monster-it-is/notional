import type { PositionListResponse } from "@notional/contracts";

import { apiRequest } from "./client.ts";

export function listPositions(): Promise<PositionListResponse> {
  return apiRequest<PositionListResponse>("/api/positions");
}
