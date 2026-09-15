export const MIN_LEVERAGE = 1;
export const MAX_LEVERAGE = 100;

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

export type OpenOrdersExistError = {
  error: "OPEN_ORDERS_EXIST";
};
