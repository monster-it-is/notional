import type { MarginSettingsResponse, UpdateMarginSettingsRequest } from "@notional/contracts";

import { apiRequest } from "./client.ts";

export function getMarginSettings(symbol: string): Promise<MarginSettingsResponse> {
  return apiRequest<MarginSettingsResponse>(`/api/margin-settings/${symbol}`);
}

export function putMarginSettings(
  symbol: string,
  body: UpdateMarginSettingsRequest,
): Promise<MarginSettingsResponse> {
  return apiRequest<MarginSettingsResponse>(`/api/margin-settings/${symbol}`, {
    method: "PUT",
    body,
  });
}
