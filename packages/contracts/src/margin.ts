export type MarginMode = "CROSS" | "ISOLATED";

export type MarginSettingsResponse = {
  symbol: string;
  marginMode: MarginMode;
  leverage: number;
};

export type UpdateMarginSettingsRequest = {
  marginMode: MarginMode;
  leverage: number;
};

export type InvalidMarginSettingsReason =
  | "INVALID_MARGIN_MODE"
  | "INVALID_LEVERAGE"
  | "UNEXPECTED_FIELD";

export type InvalidMarginSettingsError = {
  error: "INVALID_MARGIN_SETTINGS";
  reason: InvalidMarginSettingsReason;
};

export type PositionNotFlatError = {
  error: "POSITION_NOT_FLAT";
};
