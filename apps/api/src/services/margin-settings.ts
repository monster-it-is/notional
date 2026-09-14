import type {
  AccountNotInitializedError,
  AccountSuspendedError,
  InstrumentInactiveError,
  InstrumentNotFoundError,
  InvalidMarginSettingsError,
  InvalidMarginSettingsReason,
  MarginMode,
  MarginSettingsResponse,
  PositionNotFlatError,
  UpdateMarginSettingsRequest,
} from "@notional/contracts";
import {
  db,
  ensurePosition,
  findInstrumentBySymbol,
  findPaperAccountByUserId,
  findPositionByAccountAndInstrument,
  findSignupAllocationFundingEvent,
  lockPaperAccountByUserId,
  lockPositionByAccountAndInstrument,
  PositionMutationError,
  updateMarginSettingsForFlatPosition,
  type FinancialTransaction,
} from "@notional/db";
import {
  DEFAULT_LEVERAGE,
  DEFAULT_MARGIN_MODE,
  MAX_LEVERAGE,
  MIN_LEVERAGE,
} from "@notional/trading";

export class MarginSettingsError extends Error {
  readonly code:
    | "ACCOUNT_NOT_INITIALIZED"
    | "ACCOUNT_SUSPENDED"
    | "INSTRUMENT_NOT_FOUND"
    | "INSTRUMENT_INACTIVE"
    | "POSITION_NOT_FLAT"
    | "INVALID_MARGIN_SETTINGS";
  readonly reason?: InvalidMarginSettingsReason;

  constructor(
    code:
      | "ACCOUNT_NOT_INITIALIZED"
      | "ACCOUNT_SUSPENDED"
      | "INSTRUMENT_NOT_FOUND"
      | "INSTRUMENT_INACTIVE"
      | "POSITION_NOT_FLAT"
      | "INVALID_MARGIN_SETTINGS",
    reason?: InvalidMarginSettingsReason,
  ) {
    super(reason ? `${code}:${reason}` : code);
    this.name = "MarginSettingsError";
    this.code = code;
    this.reason = reason;
  }
}

export async function readMarginSettings(
  userId: string,
  symbol: string,
): Promise<MarginSettingsResponse> {
  const initialized = await loadInitializedAccount(userId);

  if (!initialized) {
    throw new MarginSettingsError("ACCOUNT_NOT_INITIALIZED");
  }

  const instrumentRow = await findInstrumentBySymbol(db, symbol);

  if (!instrumentRow) {
    throw new MarginSettingsError("INSTRUMENT_NOT_FOUND");
  }

  const position = await findPositionByAccountAndInstrument(
    db,
    initialized.account.id,
    instrumentRow.id,
  );

  if (!position) {
    return {
      symbol,
      marginMode: DEFAULT_MARGIN_MODE,
      leverage: DEFAULT_LEVERAGE,
    };
  }

  return {
    symbol,
    marginMode: position.marginMode,
    leverage: position.leverage,
  };
}

export async function updateMarginSettings(
  userId: string,
  symbol: string,
  input: UpdateMarginSettingsRequest,
): Promise<MarginSettingsResponse> {
  return db.transaction((tx) => updateMarginSettingsInTx(tx, userId, symbol, input));
}

export async function updateMarginSettingsInTx(
  tx: FinancialTransaction,
  userId: string,
  symbol: string,
  input: UpdateMarginSettingsRequest,
): Promise<MarginSettingsResponse> {
  const existing = await findPaperAccountByUserId(tx, userId);

  if (!existing) {
    throw new MarginSettingsError("ACCOUNT_NOT_INITIALIZED");
  }

  const account = await lockPaperAccountByUserId(tx, userId);
  const allocation = await findSignupAllocationFundingEvent(tx, account.id);

  if (!allocation) {
    throw new MarginSettingsError("ACCOUNT_NOT_INITIALIZED");
  }

  if (account.status === "SUSPENDED") {
    throw new MarginSettingsError("ACCOUNT_SUSPENDED");
  }

  const instrumentRow = await findInstrumentBySymbol(tx, symbol);

  if (!instrumentRow) {
    throw new MarginSettingsError("INSTRUMENT_NOT_FOUND");
  }

  if (instrumentRow.status !== "ACTIVE") {
    throw new MarginSettingsError("INSTRUMENT_INACTIVE");
  }

  await ensurePosition(tx, account.id, instrumentRow.id);
  const position = await lockPositionByAccountAndInstrument(tx, account.id, instrumentRow.id);

  try {
    const updated = await updateMarginSettingsForFlatPosition(tx, position.id, {
      marginMode: input.marginMode,
      leverage: input.leverage,
    });

    return {
      symbol,
      marginMode: updated.marginMode,
      leverage: updated.leverage,
    };
  } catch (error) {
    if (error instanceof PositionMutationError && error.code === "POSITION_NOT_FLAT") {
      throw new MarginSettingsError("POSITION_NOT_FLAT");
    }

    throw error;
  }
}

export function parseUpdateMarginSettingsRequest(
  body: unknown,
): UpdateMarginSettingsRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new MarginSettingsError("INVALID_MARGIN_SETTINGS", "UNEXPECTED_FIELD");
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);

  for (const key of keys) {
    if (key !== "marginMode" && key !== "leverage") {
      throw new MarginSettingsError("INVALID_MARGIN_SETTINGS", "UNEXPECTED_FIELD");
    }
  }

  if (!Object.hasOwn(record, "marginMode")) {
    throw new MarginSettingsError("INVALID_MARGIN_SETTINGS", "INVALID_MARGIN_MODE");
  }

  if (!Object.hasOwn(record, "leverage")) {
    throw new MarginSettingsError("INVALID_MARGIN_SETTINGS", "INVALID_LEVERAGE");
  }

  const marginMode = parseMarginMode(record.marginMode);
  const leverage = parseLeverage(record.leverage);

  return { marginMode, leverage };
}

function parseMarginMode(value: unknown): MarginMode {
  if (value === "CROSS" || value === "ISOLATED") {
    return value;
  }

  throw new MarginSettingsError("INVALID_MARGIN_SETTINGS", "INVALID_MARGIN_MODE");
}

function parseLeverage(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isSafeInteger(value) ||
    value < MIN_LEVERAGE ||
    value > MAX_LEVERAGE
  ) {
    throw new MarginSettingsError("INVALID_MARGIN_SETTINGS", "INVALID_LEVERAGE");
  }

  return value;
}

async function loadInitializedAccount(userId: string) {
  const account = await findPaperAccountByUserId(db, userId);

  if (!account) {
    return null;
  }

  const allocation = await findSignupAllocationFundingEvent(db, account.id);

  if (!allocation) {
    return null;
  }

  return { account };
}

export type MarginSettingsHttpError =
  | AccountNotInitializedError
  | AccountSuspendedError
  | InstrumentInactiveError
  | InstrumentNotFoundError
  | InvalidMarginSettingsError
  | PositionNotFlatError;
