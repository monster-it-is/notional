import type { CreateOrderRequest, InvalidOrderReason } from "@notional/contracts";
import type {
  FinancialTransaction,
  Instrument,
  Order,
  OrderWithSymbol,
  PaperAccount,
  Position,
} from "@notional/db";
import {
  cancelOpenLimitOrder,
  completeOpenLimitOrder,
  db,
  findAccountOrderById,
  findInstrumentById,
  findInstrumentBySymbol,
  findOrderByIdempotencyKey,
  findPaperAccountByUserId,
  findSignupAllocationFundingEvent,
  insertFilledOrderWithExecution,
  insertOpenLimitOrder,
  lockPaperAccountById,
  OrderMutationError,
  sameRequestFingerprint,
  sumIsolatedMarginByPaperAccountId,
  type InsertFilledOrderResult,
} from "@notional/db";
import {
  calculateInitialMargin,
  calculateNotional,
  classifyPositionTransition,
  getLimitExecutionPrice,
  getMarketExecutionPrice,
  isDecimalGte,
  isLimitMarketable,
  quantizeCollateralRequirementToNumeric3818,
  TradingMathError,
} from "@notional/trading";
import { z } from "zod";

import type { MarketDataAccess } from "../market-data/coordinator.js";
import {
  canonicalizeOrderQuantity,
  OrderValidationError,
  reduceOnlyAllows,
  validateLimitOrderFilters,
  validateMarketOrderFilters,
  validateReduceOnlyExitLimitFilters,
  validateReduceOnlyExitMarketFilters,
} from "../orders/validate-order.js";
import { applyPositionForFillResult } from "./position-application.js";
import { calculateCrossPortfolioRisk, CrossRiskError } from "./cross-risk.js";
import { IsolatedIncreaseBlockedError, isolatedReduceSettlementProtection } from "./isolated-fill.js";
import { ISOLATED_TRADING_ENABLED } from "./isolated-trading.js";
import { settleCreatedFillRealizedPnlInTx } from "./realized-settlement.js";
import {
  FundingDataUnavailableError,
  settleDueFundingForAccountInTx,
} from "./funding-settlement.js";
import {
  cancelOrderEffect,
  placeOrderEffect,
  safeOnPrivateCommitted,
  type CommittedPrivateEffect,
} from "../realtime/effects.js";
import { silentLogger, type Logger } from "../market-data/types.js";

const IDEMPOTENCY_KEY = /^[!-~]{1,128}$/;
const CANONICAL_SYMBOL = /^[A-Z0-9]+$/;

const createOrderRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("MARKET"),
      symbol: z.string().regex(CANONICAL_SYMBOL),
      side: z.enum(["BUY", "SELL"]),
      quantity: z.string(),
      reduceOnly: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("LIMIT"),
      symbol: z.string().regex(CANONICAL_SYMBOL),
      side: z.enum(["BUY", "SELL"]),
      quantity: z.string(),
      limitPrice: z.string(),
      reduceOnly: z.boolean().optional(),
    })
    .strict(),
]);

export type OrderPlacementCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_ORDER"
  | "ACCOUNT_NOT_INITIALIZED"
  | "ACCOUNT_SUSPENDED"
  | "INSTRUMENT_NOT_FOUND"
  | "INSTRUMENT_INACTIVE"
  | "MARKET_DATA_UNAVAILABLE"
  | "FUNDING_DATA_UNAVAILABLE"
  | "REDUCE_ONLY_VIOLATION"
  | "INSUFFICIENT_MARGIN"
  | "ISOLATED_TRADING_NOT_AVAILABLE"
  | "ISOLATED_REVERSE_NOT_SUPPORTED"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_CANCELLABLE";

export class OrderPlacementError extends Error {
  readonly code: OrderPlacementCode;
  readonly reason?: InvalidOrderReason;

  constructor(code: OrderPlacementCode, reason?: InvalidOrderReason, cause?: unknown) {
    super(reason ? `${code}:${reason}` : code);
    this.name = "OrderPlacementError";
    this.code = code;
    this.reason = reason;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export type PlaceOrderResult = {
  created: boolean;
  order: OrderWithSymbol;
  settledFunding: boolean;
};

export async function placeOrder(params: {
  userId: string;
  idempotencyKey: string | undefined;
  body: unknown;
  marketData: MarketDataAccess;
  onOpenOrderCommitted?: (symbol: string) => void;
  onPrivateCommitted?: (effect: CommittedPrivateEffect) => void;
  logger?: Logger;
}): Promise<PlaceOrderResult> {
  const idempotencyKey = parseIdempotencyKey(params.idempotencyKey);
  const request = parseCreateOrderRequest(params.body);
  const account = await loadInitializedAccount(params.userId);

  if (!account) {
    throw new OrderPlacementError("ACCOUNT_NOT_INITIALIZED");
  }

  const instrument = await findInstrumentBySymbol(db, request.symbol);
  const existing = await findOrderByIdempotencyKey(db, account.id, idempotencyKey);

  if (existing) {
    return replayExistingOrder(existing, request, instrument);
  }

  if (!instrument) {
    throw new OrderPlacementError("INSTRUMENT_NOT_FOUND");
  }

  const result = await db.transaction((tx) =>
    placeNewOrderInTx(tx, {
      accountId: account.id,
      idempotencyKey,
      request,
      instrument,
      marketData: params.marketData,
    }),
  );

  if (result.created && result.order.status === "OPEN") {
    params.onOpenOrderCommitted?.(result.order.symbol);
  }

  safeOnPrivateCommitted(
    params.onPrivateCommitted,
    placeOrderEffect({
      paperAccountId: account.id,
      created: result.created,
      status: result.order.status,
      settledFunding: result.settledFunding,
    }),
    params.logger ?? silentLogger,
  );

  return result;
}

export async function applyCreatedFillEffectsInTx(
  tx: FinancialTransaction,
  params: {
    account: PaperAccount;
    lockedPosition: Position;
    fill: Extract<InsertFilledOrderResult, { kind: "created_filled" | "replayed_filled" }>;
    marketData: MarketDataAccess;
    financialNow: Date;
  },
): Promise<void> {
  if (params.fill.kind === "replayed_filled") {
    return;
  }

  const applied = await applyPositionForFillResult(
    tx,
    params.lockedPosition,
    params.fill,
    params.financialNow,
  );

  if (applied.kind === "replayed") {
    return;
  }

  if (applied.position.marginMode === "ISOLATED") {
    const nextWalletBalance =
      applied.transition === "REDUCE" || applied.transition === "CLOSE"
        ? await settleCreatedFillRealizedPnlInTx(tx, {
            paperAccountId: params.account.id,
            walletBalance: params.account.balance,
            executionId: params.fill.execution.id,
            realizedPnlDelta: applied.realizedPnlDelta,
            protectedBalance: isolatedReduceSettlementProtection({
              walletBalance: params.account.balance,
              currentIsolatedMargin: applied.previousIsolatedMargin,
              nextIsolatedMargin: applied.nextIsolatedMargin,
            }).protectedBalance,
          })
        : params.account.balance;

    if (applied.transition === "OPEN" || applied.transition === "INCREASE") {
      const risk = await calculateCrossPortfolioRisk(tx, {
        paperAccount: { id: params.account.id, balance: nextWalletBalance },
        marketData: params.marketData,
      });

      if (!isDecimalGte(risk.crossAvailableBalance, "0")) {
        throw new OrderPlacementError("INSUFFICIENT_MARGIN");
      }
    }

    return;
  }

  const isolatedReservedMargin = await sumIsolatedMarginByPaperAccountId(tx, params.account.id);

  if (!isDecimalGte(params.account.balance, isolatedReservedMargin)) {
    throw new Error("isolated reserved margin exceeds walletBalance");
  }

  const nextWalletBalance = await settleCreatedFillRealizedPnlInTx(tx, {
    paperAccountId: params.account.id,
    walletBalance: params.account.balance,
    executionId: params.fill.execution.id,
    realizedPnlDelta: applied.realizedPnlDelta,
    protectedBalance: isolatedReservedMargin,
  });

  if (
    applied.transition === "OPEN" ||
    applied.transition === "INCREASE" ||
    applied.transition === "REVERSE"
  ) {
    const risk = await calculateCrossPortfolioRisk(tx, {
      paperAccount: { id: params.account.id, balance: nextWalletBalance },
      marketData: params.marketData,
    });

    if (!isDecimalGte(risk.crossAvailableBalance, "0")) {
      throw new OrderPlacementError("INSUFFICIENT_MARGIN");
    }
  }
}

async function placeNewOrderInTx(
  tx: FinancialTransaction,
  params: {
    accountId: string;
    idempotencyKey: string;
    request: CreateOrderRequest;
    instrument: Instrument;
    marketData: MarketDataAccess;
  },
): Promise<PlaceOrderResult> {
  const lockedAccount = await lockPaperAccountById(tx, params.accountId);
  const allocation = await findSignupAllocationFundingEvent(tx, lockedAccount.id);

  if (!allocation) {
    throw new OrderPlacementError("ACCOUNT_NOT_INITIALIZED");
  }

  if (lockedAccount.status === "SUSPENDED") {
    throw new OrderPlacementError("ACCOUNT_SUSPENDED");
  }

  const existing = await findOrderByIdempotencyKey(tx, lockedAccount.id, params.idempotencyKey);

  if (existing) {
    return replayExistingOrder(existing, params.request, params.instrument);
  }

  let barrier;
  try {
    barrier = await settleDueFundingForAccountInTx(tx, {
      accountId: lockedAccount.id,
      extraInstrumentIds: [params.instrument.id],
    });
  } catch (error) {
    throw mapPlacementCause(error);
  }

  const position = barrier.positions.find((row) => row.instrumentId === params.instrument.id);

  if (!position) {
    throw new Error("trading_position missing after funding barrier");
  }

  if (!ISOLATED_TRADING_ENABLED && position.marginMode === "ISOLATED") {
    throw new OrderPlacementError("ISOLATED_TRADING_NOT_AVAILABLE");
  }

  try {
    if (params.request.type === "MARKET") {
      const placed = await placeMarketOrderInTx(tx, {
        account: barrier.account,
        position,
        instrument: params.instrument,
        request: params.request,
        idempotencyKey: params.idempotencyKey,
        marketData: params.marketData,
        financialNow: barrier.financialNow,
      });
      return withSettledFunding(placed, barrier.settledBatches.length > 0);
    }

    const placed = await placeLimitOrderInTx(tx, {
      account: barrier.account,
      position,
      instrument: params.instrument,
      request: params.request,
      idempotencyKey: params.idempotencyKey,
      marketData: params.marketData,
      financialNow: barrier.financialNow,
    });
    return withSettledFunding(placed, barrier.settledBatches.length > 0);
  } catch (error) {
    throw mapPlacementCause(error);
  }
}

async function placeMarketOrderInTx(
  tx: FinancialTransaction,
  params: {
    account: PaperAccount;
    position: Position;
    instrument: Instrument;
    request: Extract<CreateOrderRequest, { type: "MARKET" }>;
    idempotencyKey: string;
    marketData: MarketDataAccess;
    financialNow: Date;
  },
): Promise<PlaceOrderResult> {
  const reduceOnly = params.request.reduceOnly ?? false;
  const quantity = canonicalizeOrderQuantity(params.request.quantity);
  const transition = classifyPositionTransition({
    currentQty: params.position.quantity,
    fillSide: params.request.side,
    fillQty: quantity,
  });

  if (reduceOnly && !reduceOnlyAllows(transition)) {
    throw new OrderPlacementError("REDUCE_ONLY_VIOLATION");
  }

  assertIsolatedReversePolicy(params.position.marginMode, transition);
  assertInstrumentEligibility(params.instrument.status, reduceOnly, transition);

  const book = params.marketData.getFreshBook(params.instrument.symbol);
  const exit = reduceOnly && reduceOnlyAllows(transition);

  const validated = exit
    ? validateReduceOnlyExitMarketFilters({
        quantity: params.request.quantity,
        side: params.request.side,
        book,
      })
    : validateMarketOrderFilters({
        side: params.request.side,
        quantity: params.request.quantity,
        instrument: params.instrument,
        markPrice: params.marketData.getFreshMark(params.instrument.symbol)?.markPrice ?? null,
        book,
      });

  if (book === null) {
    throw new OrderPlacementError("MARKET_DATA_UNAVAILABLE");
  }

  const executionPrice = getMarketExecutionPrice({
    side: params.request.side,
    bestBidPrice: book.bestBidPrice,
    bestAskPrice: book.bestAskPrice,
  });

  const fill = await insertFilledOrderWithExecution(tx, {
    paperAccountId: params.account.id,
    instrumentId: params.instrument.id,
    side: params.request.side,
    orderType: "MARKET",
    quantity: validated.quantity,
    reduceOnly,
    idempotencyKey: params.idempotencyKey,
    executionPrice,
  });

  return finishFilledPlacement(
    tx,
    params.account,
    params.position,
    fill,
    params.marketData,
    params.financialNow,
  );
}

async function placeLimitOrderInTx(
  tx: FinancialTransaction,
  params: {
    account: PaperAccount;
    position: Position;
    instrument: Instrument;
    request: Extract<CreateOrderRequest, { type: "LIMIT" }>;
    idempotencyKey: string;
    marketData: MarketDataAccess;
    financialNow: Date;
  },
): Promise<PlaceOrderResult> {
  const reduceOnly = params.request.reduceOnly ?? false;
  const quantity = canonicalizeOrderQuantity(params.request.quantity);
  const transition = classifyPositionTransition({
    currentQty: params.position.quantity,
    fillSide: params.request.side,
    fillQty: quantity,
  });

  if (reduceOnly && !reduceOnlyAllows(transition)) {
    throw new OrderPlacementError("REDUCE_ONLY_VIOLATION");
  }

  assertIsolatedReversePolicy(params.position.marginMode, transition);
  assertInstrumentEligibility(params.instrument.status, reduceOnly, transition);

  const exit = reduceOnly && reduceOnlyAllows(transition);
  const validated = exit
    ? validateReduceOnlyExitLimitFilters({
        quantity: params.request.quantity,
        limitPrice: params.request.limitPrice,
        instrument: params.instrument,
      })
    : validateLimitOrderFilters({
        quantity: params.request.quantity,
        limitPrice: params.request.limitPrice,
        instrument: params.instrument,
      });

  const book = params.marketData.getFreshBook(params.instrument.symbol);

  if (book === null) {
    throw new OrderPlacementError("MARKET_DATA_UNAVAILABLE");
  }

  const marketable = isLimitMarketable({
    side: params.request.side,
    limitPrice: validated.limitPrice,
    bestBidPrice: book.bestBidPrice,
    bestAskPrice: book.bestAskPrice,
  });

  if (marketable) {
    const executionPrice = getLimitExecutionPrice({
      side: params.request.side,
      limitPrice: validated.limitPrice,
      bestBidPrice: book.bestBidPrice,
      bestAskPrice: book.bestAskPrice,
    });

    if (executionPrice === null) {
      throw new OrderPlacementError("MARKET_DATA_UNAVAILABLE");
    }

    const fill = await insertFilledOrderWithExecution(tx, {
      paperAccountId: params.account.id,
      instrumentId: params.instrument.id,
      side: params.request.side,
      orderType: "LIMIT",
      quantity: validated.quantity,
      limitPrice: validated.limitPrice,
      reduceOnly,
      idempotencyKey: params.idempotencyKey,
      executionPrice,
    });

    return finishFilledPlacement(
      tx,
      params.account,
      params.position,
      fill,
      params.marketData,
      params.financialNow,
    );
  }

  const reservedMargin = exit
    ? "0"
    : await requireRestingReservation(tx, {
        account: params.account,
        position: params.position,
        quantity: validated.quantity,
        limitPrice: validated.limitPrice,
        marketData: params.marketData,
      });

  const inserted = await insertOpenLimitOrder(tx, {
    paperAccountId: params.account.id,
    instrumentId: params.instrument.id,
    side: params.request.side,
    orderType: "LIMIT",
    quantity: validated.quantity,
    limitPrice: validated.limitPrice,
    reservedMargin,
    reduceOnly,
    idempotencyKey: params.idempotencyKey,
  });

  if (inserted.kind === "key_reused") {
    throw new OrderPlacementError("IDEMPOTENCY_KEY_REUSED");
  }

  return {
    created: inserted.kind === "created",
    order: await requireOrderResponse(tx, params.account.id, inserted.order.id),
    settledFunding: false,
  };
}

async function requireRestingReservation(
  tx: FinancialTransaction,
  params: {
    account: PaperAccount;
    position: Position;
    quantity: string;
    limitPrice: string;
    marketData: MarketDataAccess;
  },
): Promise<string> {
  const reservedMargin = quantizeCollateralRequirementToNumeric3818(
    calculateInitialMargin({
      notional: calculateNotional({
        quantity: params.quantity,
        price: params.limitPrice,
      }),
      leverage: String(params.position.leverage),
    }),
  );
  const risk = await calculateCrossPortfolioRisk(tx, {
    paperAccount: params.account,
    marketData: params.marketData,
  });

  if (!isDecimalGte(risk.crossAvailableBalance, reservedMargin)) {
    throw new OrderPlacementError("INSUFFICIENT_MARGIN");
  }

  return reservedMargin;
}

async function finishFilledPlacement(
  tx: FinancialTransaction,
  account: PaperAccount,
  position: Position,
  fill: InsertFilledOrderResult,
  marketData: MarketDataAccess,
  financialNow: Date,
): Promise<PlaceOrderResult> {
  if (fill.kind === "key_reused") {
    throw new OrderPlacementError("IDEMPOTENCY_KEY_REUSED");
  }

  if (fill.kind === "replayed_order") {
    return {
      created: false,
      order: await requireOrderResponse(tx, account.id, fill.order.id),
      settledFunding: false,
    };
  }

  await applyCreatedFillEffectsInTx(tx, {
    account,
    lockedPosition: position,
    fill,
    marketData,
    financialNow,
  });

  return {
    created: fill.kind === "created_filled",
    order: await requireOrderResponse(tx, account.id, fill.order.id),
    settledFunding: false,
  };
}

export async function completeMatcherFillInTx(
  tx: FinancialTransaction,
  params: {
    account: PaperAccount;
    position: Position;
    order: Order;
    executionPrice: string;
    marketData: MarketDataAccess;
    financialNow: Date;
  },
): Promise<void> {
  try {
    const fill = await completeOpenLimitOrder(
      tx,
      params.account.id,
      params.order.id,
      params.executionPrice,
    );

    await applyCreatedFillEffectsInTx(tx, {
      account: params.account,
      lockedPosition: params.position,
      fill,
      marketData: params.marketData,
      financialNow: params.financialNow,
    });
  } catch (error) {
    throw mapPlacementCause(error);
  }
}

async function replayExistingOrder(
  existing: Order,
  request: CreateOrderRequest,
  instrument: Instrument | null,
): Promise<PlaceOrderResult> {
  const instrumentId = instrument?.id ?? existing.instrumentId;

  if (instrument === null) {
    const owned = await findInstrumentById(db, existing.instrumentId);

    if (owned?.symbol !== request.symbol) {
      throw new OrderPlacementError("IDEMPOTENCY_KEY_REUSED");
    }
  }

  const attempted = {
    instrumentId,
    side: request.side,
    orderType: request.type,
    quantity: request.quantity,
    limitPrice: request.type === "LIMIT" ? request.limitPrice : null,
    reduceOnly: request.reduceOnly ?? false,
  };

  if (!sameRequestFingerprint(existing, attempted)) {
    throw new OrderPlacementError("IDEMPOTENCY_KEY_REUSED");
  }

  const withSymbol = await findAccountOrderById(db, existing.paperAccountId, existing.id);

  if (!withSymbol) {
    throw new OrderPlacementError("INSTRUMENT_NOT_FOUND");
  }

  return { created: false, order: withSymbol, settledFunding: false };
}

export async function cancelUserOrder(params: {
  userId: string;
  orderId: string;
  onPrivateCommitted?: (effect: CommittedPrivateEffect) => void;
  logger?: Logger;
}): Promise<OrderWithSymbol> {
  const account = await loadInitializedAccount(params.userId);

  if (!account) {
    throw new OrderPlacementError("ACCOUNT_NOT_INITIALIZED");
  }

  try {
    const cancelled = await db.transaction(async (tx) => {
      const current = await findAccountOrderById(tx, account.id, params.orderId);
      const changed = current?.status === "OPEN";
      const order = await cancelOpenLimitOrder(tx, account.id, params.orderId);
      return { order, changed };
    });
    const withSymbol = await findAccountOrderById(db, account.id, cancelled.order.id);

    if (!withSymbol) {
      throw new OrderPlacementError("ORDER_NOT_FOUND");
    }

    if (cancelled.changed) {
      safeOnPrivateCommitted(
        params.onPrivateCommitted,
        cancelOrderEffect(account.id),
        params.logger ?? silentLogger,
      );
    }

    return withSymbol;
  } catch (error) {
    if (error instanceof OrderMutationError) {
      throw new OrderPlacementError(error.code);
    }

    throw error;
  }
}

function withSettledFunding(result: PlaceOrderResult, settledFunding: boolean): PlaceOrderResult {
  return { ...result, settledFunding };
}

async function requireOrderResponse(
  executor: FinancialTransaction,
  paperAccountId: string,
  orderId: string,
): Promise<OrderWithSymbol> {
  const order = await findAccountOrderById(executor, paperAccountId, orderId);

  if (!order) {
    throw new Error("trade_order missing after placement");
  }

  return order;
}

function parseIdempotencyKey(value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new OrderPlacementError("IDEMPOTENCY_KEY_REQUIRED");
  }

  if (!IDEMPOTENCY_KEY.test(value)) {
    throw new OrderPlacementError("IDEMPOTENCY_KEY_INVALID");
  }

  return value;
}

function parseCreateOrderRequest(body: unknown): CreateOrderRequest {
  const parsed = createOrderRequestSchema.safeParse(body);

  if (!parsed.success) {
    throw new OrderPlacementError("INVALID_ORDER");
  }

  return parsed.data;
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

  return account;
}

function assertIsolatedReversePolicy(
  marginMode: Position["marginMode"],
  transition: ReturnType<typeof classifyPositionTransition>,
): void {
  if (marginMode === "ISOLATED" && transition === "REVERSE") {
    throw new OrderPlacementError("ISOLATED_REVERSE_NOT_SUPPORTED");
  }
}

function assertInstrumentEligibility(
  status: string,
  reduceOnly: boolean,
  transition: ReturnType<typeof classifyPositionTransition>,
): void {
  if (status === "ACTIVE") {
    return;
  }

  if (reduceOnly && reduceOnlyAllows(transition)) {
    return;
  }

  throw new OrderPlacementError("INSTRUMENT_INACTIVE");
}

function mapPlacementCause(error: unknown): unknown {
  if (error instanceof OrderPlacementError) {
    return error;
  }

  if (error instanceof FundingDataUnavailableError) {
    return new OrderPlacementError("FUNDING_DATA_UNAVAILABLE");
  }

  if (error instanceof IsolatedIncreaseBlockedError) {
    return new OrderPlacementError("INSUFFICIENT_MARGIN");
  }

  if (error instanceof OrderValidationError) {
    return new OrderPlacementError(error.code, error.reason, error);
  }

  if (error instanceof CrossRiskError) {
    return new OrderPlacementError("MARKET_DATA_UNAVAILABLE");
  }

  if (error instanceof TradingMathError) {
    if (error.code === "OVERFLOW") {
      return new OrderPlacementError("INVALID_ORDER", "INVALID_QUANTITY", error);
    }

    return new OrderPlacementError("INVALID_ORDER", undefined, error);
  }

  return error;
}
