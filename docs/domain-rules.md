# Domain Rules

## Product

Notional is a paper crypto perpetual futures trading simulator.

It is not a real exchange, custody platform, wallet, payment system, or real-money trading system.

Binance is used only as a market-data source.

The backend owns all simulated trading state and decisions.

## Account Model

- One user has exactly one paper trading account.
- The account collateral currency is USDT only.
- No multi-currency wallet system in MVP.
- No real deposits.
- No withdrawals.
- No admin funding workflow.

Database invariant:

- one user -> one paper account

## Signup Allocation

Every eligible user receives exactly 1,000 USDT of virtual simulator credit exactly once.

Better Auth user creation commits first and is not part of the financial transaction.

The following financial effects are atomic with each other:

- paper account
- USER_CASH ledger account
- SYSTEM_VIRTUAL_FUNDING ledger account
- SIGNUP_ALLOCATION funding event
- SIGNUP_ALLOCATION ledger transaction
- two balanced ledger entries
- paper-account balance projection

Retries and concurrent initialization must not create a second credit.

Eligibility is the absence of SIGNUP_ALLOCATION history, never the current balance.

`POST /api/account/initialize` is the recoverable initialization boundary.

`GET /api/account` is read-only and must not create financial state.

## Faucet

Users can claim virtual USDT through a faucet.

`POST /api/account/faucet` is authenticated, takes no amount, and credits only an initialized `ACTIVE` paper account.

The faucet amount is process configuration (`FAUCET_AMOUNT`), parsed as a positive `NUMERIC(38,18)` decimal string. Signup allocation remains exactly 1,000 USDT and is not configurable.

Eligibility uses PostgreSQL wall-clock time (`clock_timestamp()`) after the paper-account row lock is acquired, never transaction-start time, client time, or Node `Date.now()`.

Eligible when:

- `last_faucet_claim_at IS NULL`, or
- `clock_timestamp() >= last_faucet_claim_at + interval '24 hours'`

Equality at exactly 24 hours is allowed. `paper_account.last_faucet_claim_at` is authoritative for cooldown. Funding history is immutable audit. Both are written in the same financial transaction.

Rejected cooldown attempts return `409 { error: "FAUCET_COOLDOWN", nextClaimAt }` and create no financial rows. `SUSPENDED` accounts cannot claim (`409 ACCOUNT_SUSPENDED`). Uninitialized users must call `POST /api/account/initialize` first.

Accounting for each successful claim:

- USER_CASH: `+FAUCET_AMOUNT`
- SYSTEM_VIRTUAL_FUNDING: `-FAUCET_AMOUNT`
- one `FAUCET_CLAIM` funding event and ledger transaction

Concurrent claims serialize on `SELECT ... FOR UPDATE`. A lost success response followed by an immediate retry may return cooldown; it must never credit twice.

`GET /api/account/funding` is a pure read of business funding history for an initialized account.

## Financial Authority

PostgreSQL is authoritative for financial state.

Redis must never be authoritative for:

- balances
- ledger
- orders
- executions
- positions
- liquidation state
- funding history
- faucet history

If Redis is lost, financial correctness must remain intact.

## Financial Arithmetic

Never use JavaScript `Number` as the canonical representation for financial values.

Use exact decimal arithmetic. Trading-domain math lives in `@notional/trading` (`TradingDecimal`, `decimal.js` clone, precision 80, `ROUND_HALF_EVEN`). Ledger/config persistence in `@notional/db` continues to use `MoneyDecimal` (precision 50) as a PostgreSQL boundary and does not implement trading formulas.

Persist financial values using PostgreSQL `NUMERIC(38,18)`.

This applies to:

- balances
- prices
- quantities
- PnL
- margin
- fees
- funding
- liquidation calculations

Avoid unnecessary intermediate rounding.

Trading-domain input strings are plain decimal notation only (`0`, `1`, `0.001`, `-0.0001`). Reject scientific notation, whitespace, a leading `+`, `NaN`, `Infinity`, and malformed leading zeros. Canonical math output never uses scientific notation, never emits negative zero (`-0` becomes `0`), and does not pad trailing zeros.

### Calculation vs persistence

Precision 80 is justified for **one transition** whose authoritative inputs already fit `NUMERIC(38,18)`. It is not a claim that arbitrary chaining of unquantized intermediates stays exact forever.

Committed/quantized PostgreSQL state
→ one `applyFillToPosition` calculation
→ explicit persistence quantization where required (`quantizeToNumeric3818`)
→ the resulting committed row is the authority for the next transition.

Quantities (`fillQty`, `currentQty`, `nextQty`) and externally constrained execution prices are never rounded to fit the column. If they do not fit `NUMERIC(38,18)`, the math layer throws `OVERFLOW`.

Derived values may have more than 18 fractional digits during calculation:

- weighted average entry price
- realized PnL
- notional (especially before MIN_NOTIONAL comparison)
- initial margin (`notional / leverage`)

Those derived values use explicit `ROUND_HALF_EVEN` quantization only when persisted. MIN_NOTIONAL comparison and tick/step grid checks must not round first.

Once `nextEntryPrice` is quantized and committed, that persisted entry is the authoritative cost basis. Future realized PnL uses the persisted entry. Do not keep a hidden higher-precision historical entry; financial state must be reproducible from PostgreSQL.

## Position Model

For MVP, use one net position per account and instrument.

Persisted paper positions live in PostgreSQL `trading_position`. Identity is unique `(paper_account_id, instrument_id)`. The application type is `Position`. The row is created lazily on the first fill for that pair and is never deleted merely because it becomes flat. Reopen reuses the same row.

Use signed quantity only. Do not store a separate LONG/SHORT direction.

- `qty > 0` → LONG
- `qty < 0` → SHORT
- `qty = 0` → FLAT

Fill quantity is always positive. Convert side to signed fill quantity:

- BUY → `+fillQty`
- SELL → `-fillQty`

Then:

`nextQty = currentQty + signedFillQty`

Flat and open state are exclusive:

- flat: `qty == 0` and `entryPrice == null`
- open: `qty != 0` and `entryPrice != null` and `entryPrice > 0`

Zero is not a legitimate entry price. PostgreSQL CHECK `trading_position_qty_entry_invariant` enforces the shape.

`realized_pnl` on the row is cumulative lifetime realized trading PnL for that persistent account/instrument identity. It is not reset on CLOSE or reopen. OPEN/INCREASE add a quantized delta of `0`. REDUCE/CLOSE/REVERSE add the quantized per-fill `realizedPnlDelta`. Public reads expose this as `cumulativeRealizedPnl`. Unrealized PnL is not stored; it depends on a fresh mark.

`applyFillToPosition` is the single fill-application function. Persistence then uses `toPersistedFillState`: quantity is never rounded; derived entry and realized delta are quantized with `ROUND_HALF_EVEN` scale 18; cumulative realized PnL is exact `NUMERIC(38,18)` addition of the quantized delta. The persisted quantized entry is the next fill’s cost basis.

Transitions:

- OPEN: previous flat; `entry = fillPrice`; realized PnL `0`
- INCREASE: same direction; quantity-weighted average entry; realized PnL `0`
- REDUCE: opposing fill smaller than position; entry unchanged; realize closed quantity only
- CLOSE: opposing fill equal to position; `qty = 0`; `entry = null`; the row remains
- REVERSE: opposing fill larger than position; close the old quantity first and realize it; residual opens at `fillPrice` (do not blend the old entry)

Weighted average entry (INCREASE):

```
newEntry =
(
  abs(oldQty) × oldEntry
  +
  abs(fillQty) × fillPrice
)
/
abs(newQty)
```

This is symmetric for long and short.

Closed/opened quantity during a fill:

- same direction: `closedQty = 0`, `openedQty = fillQty`
- opposing: `closedQty = min(abs(currentQty), fillQty)`, `openedQty = max(fillQty - abs(currentQty), 0)`

Do not implement hedge mode in MVP.

Only `created_filled` execution results may apply position (and later margin/ledger) effects. `replayed_filled` returns committed facts and must not reapply them. `OPEN` plus a pre-existing execution is `EXECUTION_CONFLICT`, not a heal-to-FILLED replay.

Position mutation uses `execution.price`. Never BBO, mark, or limit after the execution exists. Reduce-only is classified against the locked current position before execution creation, not inside position persistence.

Permanent lock order for financial mutations is `paper_account FOR UPDATE → instrument FOR SHARE → trading_position FOR UPDATE → trade_order FOR UPDATE`. Instrument SHARE blocks catalog status UPDATE without serializing unrelated accounts on the same instrument. Cancellation is the intentional exception: it locks only the order row. Catalog sync does not acquire paper-account, position, or order locks. There is no public position mutation HTTP. Authenticated reads are `GET /api/positions` (open rows only) and `GET /api/positions/:symbol` (absent or flat → `POSITION_NOT_FOUND`). An existing nonzero position remains if the instrument later becomes `INACTIVE`; entry price is historical cost basis and is never rewritten because filters or status changed.

Phase 11 persists position state only. It does not mutate `paper_account.balance` or post trading ledger entries. Margin configuration and accounting remain Phase 12/13.

The same persistent row also stores per-symbol trading settings after Phase 12: `margin_mode`, `leverage`, and `isolated_margin`. Flat rows can hold future settings. A settings change on a symbol with no row may create the canonical flat row through `ensurePosition`.

## Orders

Persisted paper orders live in PostgreSQL `trade_order`. Notional never places orders on Binance.

Identity:

- `trade_order.id` is the stable internal UUID
- executions reference `trade_order.id` with `UNIQUE(execution.order_id)` in MVP
- `paper_account_id` and `instrument_id` are RESTRICT foreign keys
- placement retries use `idempotency_key`, which is unique per paper account and is not the order id
- there is no clientOrderId and no Binance order id

Types:

- MARKET
- LIMIT

Side is `BUY` or `SELL`. Quantity is a positive absolute requested size. Direction is not stored as a signed quantity.

MARKET:

- `limit_price` is NULL
- the only legal persisted status is `FILLED`
- a MARKET order is never `OPEN` or `CANCELLED`
- a MARKET order is never queued for later execution

LIMIT:

- `limit_price` is required and positive
- status is `OPEN`, `FILLED`, or `CANCELLED`
- LIMIT is implicitly GTC; there is no `time_in_force` column

Statuses are only:

- `OPEN` — resting LIMIT
- `FILLED` — completely filled
- `CANCELLED` — previously OPEN LIMIT that was cancelled

There is no `PENDING`, `ACCEPTED`, `REJECTED`, or `PARTIALLY_FILLED`. Failed placements that never insert a row do not consume the idempotency key.

MVP does not implement true partial fills. Do not persist filled/remaining quantity on the order. One `FILLED` order has exactly one `execution` row (`UNIQUE(order_id)`). `execution.quantity` is the full persisted order quantity. Partial fills would require a deliberate migration of that unique constraint.

Public HTTP is authenticated and account-scoped for orders (`GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders`, `POST /api/orders/:id/cancel`), executions (`GET /api/executions`, `GET /api/executions/:id`), positions (`GET /api/positions`, `GET /api/positions/:symbol`), and liquidations (`GET /api/liquidations`). Authenticated `GET`/`PUT /api/margin-settings/:symbol` mutate settings only while FLAT and with no OPEN order for that account+instrument (`OPEN_ORDERS_EXIST`). There is no `POST /api/executions`, `POST /api/positions`, or liquidation mutation endpoint; fills are system-generated and positions are derived. Cancellation is an `OPEN → CANCELLED` transition on a locked LIMIT row (`reserved_margin = 0`). MARKET is not cancellable. A second cancel of an already CANCELLED order is idempotent success. FILLED cannot be cancelled (`ORDER_NOT_CANCELLABLE`). Suspended accounts and INACTIVE instruments may cancel. Cancel locks only the order row.

`insertOpenLimitOrder` inserts LIMIT `OPEN` only. FILLED MARKET and immediately filled LIMIT rows are created only through `insertFilledOrderWithExecution` (order + execution in one transaction). Resting LIMIT completion uses `completeOpenLimitOrder` (`OPEN → FILLED` + execution). Production helpers must not create `CANCELLED` directly or create a `FILLED` order without its execution.

A `FILLED` order conceptually has exactly one execution. `OPEN` and `CANCELLED` orders have none. Cancel and fill both `SELECT ... FOR UPDATE` the same `trade_order` row: if fill commits first, cancel returns `ORDER_NOT_CANCELLABLE`; if cancel commits first, fill returns `ORDER_ALREADY_CANCELLED` and inserts no execution. A second fill of an already `FILLED` order returns `replayed_filled` with the original execution and must not re-price it. `OPEN` plus a pre-existing execution is `EXECUTION_CONFLICT` and must not be healed to `FILLED`.

Execution rows are immutable historical facts (`quantity`, `price`, `executed_at`). `executed_at` is a UTC-naive PostgreSQL timestamp sampled once with `clock_timestamp() AT TIME ZONE 'UTC'` at the fill. Reads interpret that column as UTC before the API boundary. Later fees and realized PnL reference the execution; they must not mutate it.

Reduce-only is a persisted boolean defaulting to false. Placement persists the flag. Actual execution must re-classify against the then-current locked position with `classifyPositionTransition`. Only `REDUCE` and `CLOSE` may execute. `OPEN`, `INCREASE`, and `REVERSE` must fail (`REDUCE_ONLY_VIOLATION`) with no filter waiver.

**Reduce-only exit-safety is Notional policy, not a Binance exemption.** After account and position locks, canonicalize positive quantity, classify, enforce reduce-only, then choose validation. If `reduceOnly` and the transition is REDUCE or CLOSE: quantity must be positive, exact, and fit `NUMERIC(38,18)`; waive LOT_SIZE / MARKET_LOT_SIZE min/max/step and MIN_NOTIONAL; LIMIT still requires PRICE_FILTER and a fresh BBO (resting reservation `0`); MARKET still requires a fresh BBO (BUY ask / SELL bid) and does not require a mark solely for MIN_NOTIONAL. Do not run a full CROSS portfolio margin sweep for REDUCE/CLOSE. The matcher must re-classify reduce-only against the locked current position; if it is no longer REDUCE/CLOSE, leave OPEN.

New orders require an initialized `ACTIVE` paper account. Uninitialized accounts return `ACCOUNT_NOT_INITIALIZED`. Suspended accounts cannot place user orders. CROSS and ISOLATED settings may trade. Isolated REVERSE is unsupported (`ISOLATED_REVERSE_NOT_SUPPORTED`). Historical order rows are never deleted. Instrument inactivity does not delete, auto-cancel, or silently release reservation on existing OPEN orders. Users may cancel those orders manually. New OPEN/INCREASE/REVERSE against INACTIVE returns `INSTRUMENT_INACTIVE`. reduceOnly REDUCE/CLOSE against INACTIVE is allowed when the required BBO is fresh. Liquidation may close an INACTIVE position with a fresh BBO. Matcher: INACTIVE non-reduce orders do not fill; INACTIVE reduceOnly REDUCE/CLOSE may fill with a fresh BBO.

PRICE_FILTER / LOT_SIZE / MARKET_LOT_SIZE / MIN_NOTIONAL checks are exact Decimal arithmetic in `@notional/trading`. PRICE_FILTER zeros disable the corresponding sub-rule (`minPrice`, `maxPrice`, `tickSize`). When tick alignment is enabled:

`(price - minPrice) mod tickSize == 0`

Quantity filters are caller-selected: limit orders use LOT_SIZE fields, market orders use MARKET_LOT_SIZE fields. Do not mix them. When the quantity step is enabled:

`(quantity - minQty) mod stepSize == 0`

MIN_NOTIONAL:

`abs(quantity) × relevantPrice >= minNotional`

without rounding before comparison. `satisfiesMinNotional({ quantity, price, minNotional })` is generic and does not fetch market data. The caller supplies `price`.

Binance USD-M filter validation:

- LIMIT MIN_NOTIONAL uses the order's LIMIT price
- MARKET MIN_NOTIONAL uses a fresh **mark price**

Do not use best bid/ask for MARKET MIN_NOTIONAL. Execution price is separate:

- MARKET BUY executes at a fresh best ask
- MARKET SELL executes at a fresh best bid
- BUY LIMIT is marketable when `bestAsk <= limitPrice` and then fills at the current best ask
- SELL LIMIT is marketable when `bestBid >= limitPrice` and then fills at the current best bid

A marketable LIMIT therefore receives BBO price improvement versus always filling at the user limit. A non-marketable LIMIT rests `OPEN` with no execution.

LIMIT static-filter validation does not require live market data. Executable MARKET validation requires both a fresh mark and a fresh BBO. Freshness is independent. Placement validation never authorizes a later fill; execution must re-read required market state and fail closed if stale. Resting LIMIT execution uses persisted limit terms plus a fresh BBO and does not rerun MARKET min-notional.

Do not copy instrument filter snapshots onto order rows. Placement uses filters current at placement. An already accepted OPEN LIMIT is not retroactively invalid solely because catalog filters later change. An INACTIVE non-reduce OPEN order is not matched and is not auto-cancelled; reservation stays until the user cancels. INACTIVE reduceOnly REDUCE/CLOSE may rest and match.

Idempotency:

- unique `(paper_account_id, idempotency_key)`
- fingerprint is instrument, side, type, canonical quantity, canonical limit price or null, and reduce-only
- fingerprint excludes status, timestamps, and execution price so a retry after FILLED/CANCELLED still returns the same order and, if FILLED, the original execution
- concurrent identical inserts use `INSERT ... ON CONFLICT DO NOTHING` then SELECT
- when public POST exists, a matching existing key must return the existing order without re-running mutable placement validation, including current BBO pricing. Ordinary HTTP replay must not acquire account/position locks first. Matcher fills of existing OPEN orders still lock `account → position → order`.

Never physically delete normal order records. Test cleanup may truncate.

## Margin

Supported:

- isolated margin
- cross margin
- user-selectable leverage

There are no margin tiers. Permanently do not introduce:

- risk tiers
- notional tiers
- position-size tiers
- tier-based leverage
- tier-based maintenance margin
- Binance leverage/maintenance brackets
- a `margin_tier` table

One product-wide model: leverage integers `1..100` (default `1`, default mode `CROSS`), encoded as domain constants plus PostgreSQL CHECK. Not an environment variable.

`paper_account.balance` is wallet / realized cash. It does not include unrealized PnL. Margin reservation does not mutate wallet balance and is not a ledger funding event.

**CROSS:** the position is supported by account-level cross collateral. `isolated_margin` is always `0`. Fresh-mark unrealized PnL contributes to cross collateral.

**ISOLATED:** only that position’s `isolated_margin` plus its own unrealized PnL support it. Other account equity must not silently rescue it. `isolated_margin` is a reserved subset of wallet cash, not extra money. Isolated unrealized PnL must not increase cross available balance. Isolated OPEN/INCREASE allocate `ROUND_UP(abs(qty) × persistedEntry / leverage)` in the same position UPDATE as qty/entry/realized PnL. Isolated REVERSE is not supported.

Formulas (exact decimal strings; do not clamp; no JavaScript `Number` for money/rates):

```
initialMargin = notional / leverage

crossPositionInitialMargin = abs(qty) × freshMark / leverage
crossInitialMargin = sum of CROSS position initial margins

walletBalance = paper_account.balance
isolatedReservedMargin = sum(isolated_margin)
crossUnrealizedPnl = sum of CROSS unrealized PnL at fresh mark
crossCollateral = walletBalance - isolatedReservedMargin + crossUnrealizedPnl
crossAvailableBalance = crossCollateral - crossInitialMargin - openOrderReservedMargin

isolatedEquity = isolatedMargin + unrealizedPnl
requiredIsolatedMargin = 0 when flat
requiredIsolatedMargin = abs(qty) × persistedEntry / leverage when open
```

`openOrderReservedMargin` is the sum of OPEN `trade_order.reserved_margin`. Negative available balance is meaningful. Affordability is `availableBalance >= requiredAdditionalMargin`.

`reserved_margin` is placement-time collateral reservation only. Formula for non-reduce OPEN LIMIT:

```
orderNotional = quantity × limitPrice
rawRequiredMargin = orderNotional / leverage
reserved_margin = ROUND_UP(rawRequiredMargin, 18)
```

Reduce-only OPEN LIMIT reserves `0`. Do not re-reserve on market ticks. SELL LIMIT price improvement can raise later fill IM; the post-fill CROSS check is the backstop.

Collateral requirements round **up** to `NUMERIC(38,18)`. PnL, entry, and wallet accounting stay `ROUND_HALF_EVEN`.

Isolated reserve uses persisted entry after the fill, not mark. Persist isolated collateral with `quantizeCollateralRequirementToNumeric3818` (`ROUND_UP` to 18 decimals). Do not use HALF_EVEN for isolated collateral. Mark changes do not rewrite `isolated_margin`.

Maintenance:

```
maintenanceMargin = notional × maintenanceMarginRate
```

`0 < maintenanceMarginRate < 1`. The product rate is `MAINTENANCE_MARGIN_RATE = "0.005"` in `@notional/trading`, not env. Leverage does not change the maintenance rate. Equality liquidates: `equity <= maintenanceMargin`.

Unrealized PnL, cross initial margin, isolated equity, maintenance, and liquidation use a fresh mark. If any CROSS position required for account-level risk lacks a fresh mark, fail closed. Do not omit a losing position. Do not substitute entry, BBO, index, or last trade.

Settings mutation is allowed only while FLAT and with no OPEN order for that account+instrument. Settings lock `paper_account FOR UPDATE` then `trading_position FOR UPDATE` and do not require instrument SHARE. Public HTTP: `GET`/`PUT /api/margin-settings/:symbol`. GET with no row returns defaults without insert. PUT body is exactly `{ marginMode, leverage }`. OPEN orders return `OPEN_ORDERS_EXIST`.

**CROSS realized settlement:** `realizedPnlDelta` is the full trading result on the position. Wallet absorbs a user/matcher CROSS loss only down to existing isolated reserved margin (`protectedBalance = sum(isolated_margin)`). If isolated reserve exceeds wallet, that is financial-state corruption and must fail loudly. Insurance absorbs any residual. Wallet stays `>= 0` and never below isolated reserved collateral. Do not claim the wallet mutation always equals `realizedPnlDelta`. Ledger `REALIZED_PNL` entries are balanced and do not create `funding_event` rows.

**Isolated REDUCE/CLOSE settlement:** loss capacity is released isolated margin (`currentIsolatedMargin - nextIsolatedMargin`). User wallet may lose at most that amount. Insurance absorbs any remaining isolated gap. Isolated profit credits USER_CASH in full. Do not run a full CROSS affordability sweep on isolated REDUCE/CLOSE.

## PnL

For linear USDT-margined perpetuals only (multiplier 1). No inverse, coin-margined, or options formulas.

Notional:

`abs(position or order quantity) * reference price`

Notional is never negative. The caller supplies the price appropriate to the context. Do not default to mark inside a generic notional function.

Initial margin primitive:

`notional / leverage`

`leverage` is a positive integer. The `calculateInitialMargin` primitive does not cap max leverage. Product settings persist integers `1..100` (Phase 12). OPEN LIMIT reservation, CROSS portfolio checks, isolated allocation, realized settlement, liquidation, and perpetual funding settlement are implemented.

Using signed quantity:

`unrealized PnL = signed quantity * (mark price - entry price)`

Flat unrealized PnL is exactly `0`.

Realized PnL for a closing quantity, fees excluded:

`realizedPnl = closedQty × (exitPrice - entryPrice) × sign(currentQty)`

`closedQty > 0`. Positive means profit to the user. Negative means loss. Do not mix trading fees into realized trading PnL.

Mark price is used for:

- unrealized PnL
- liquidation
- margin/risk calculations

## Liquidation

Liquidation uses a deterministic documented Notional model. It does not reproduce Binance brackets, partial liquidation, ADL, or a liquidation fee.

Trigger uses a fresh mark. Execution uses a fresh BBO (LONG SELL at bid, SHORT BUY at ask). Never trigger or fill from entry, index, last trade, or a synthetic liquidation price. Do not persist an authoritative liquidation price.

```
crossEquity = walletBalance - isolatedReservedMargin + crossUnrealizedPnl
crossMaintenanceMargin = SUM(abs(CROSS qty) × freshMark × 0.005)
isolatedEquity = isolatedMargin + unrealizedPnl(mark)
isolatedMaintenanceMargin = abs(qty) × freshMark × 0.005
```

`equity <= maintenanceMargin` liquidates, including equality. A CROSS book with no nonzero CROSS positions does not emit a CROSS liquidation event even if equity is `<= 0`. Every required mark and BBO must be fresh; missing one is skip/retry, never a partial CROSS close.

CROSS liquidation is a full-account close of every nonzero CROSS position in one transaction and one `liquidation_event` (`instrument_id` NULL). Wallet/insurance settlement is aggregate: sum all position `realizedPnlDelta` values, then one `calculateWalletRealizedSettlement` against the pre-liquidation wallet with `protectedBalance = total isolated_margin`. One `REALIZED_PNL` ledger transaction uses idempotency `liquidation-realized:<eventId>`. Processing order must not change wallet, insurance, or trading-PnL.

ISOLATED liquidation closes only the breached position. Next isolated margin is 0. Per-execution `REALIZED_PNL` uses `realized-pnl:<executionId>` with isolated loss containment. Other positions are untouched.

Liquidation orders are `origin = LIQUIDATION`, `MARKET`, `FILLED`, `reduceOnly`, `reserved_margin = 0`, and skip LOT_SIZE / MARKET_LOT_SIZE / MIN_NOTIONAL / PRICE_FILTER. User orders remain `origin = USER`. `CreateOrderRequest` does not accept origin. There is no `LIQUIDATION` ledger event type.

Financial liquidation, cancellations, orders, executions, positions, wallet, and ledger live in one PostgreSQL transaction. Any failure rolls back with no trace. Risk is re-checked after locks. The in-process scanner is a trigger only.

SUSPENDED accounts remain liquidatable. HTTP user cancel stays order-row-only. Liquidation locks the paper account first. There is no live public risk endpoint.

## Perpetual funding

Funding is a separate economic concept from trading realized PnL and from paper-wallet `funding_event` credits.

```
fundingPayment = -(signedQuantity × settlementMarkPrice × fundingRate)
```

The persisted HALF_EVEN rate and mark are authoritative. Longs pay when the rate is positive. Isolated funding moves wallet and isolated collateral together and never spends other positions' collateral. CROSS payments at one `funding_time` net, then settle once against remaining free cash. Different timestamps never net. Insurance absorbs CROSS and isolated shortfalls the same way as other protected settlement.

`funding_cursor_at` is eligibility, not "last funded". OPEN from flat skips past cycles. The transaction samples `financialNow` after the account lock. The barrier must prove `(cursor, financialNow]` from realized history and/or this process's `LiveScheduleProof`. Restart clears prospective schedule proof.

Authenticated `GET /api/funding` lists position-level perpetual funding history. `GET /api/account/funding` remains faucet/signup history.

## Ledger

The ledger is the immutable explanation of financial changes.

Signed amounts are the permanent convention. For a posted ledger transaction, the signed entry amounts sum to zero.

The paper-account balance is a current projection for fast reads.

Do not model financial correctness as only:

`balance = balance + amount`

Balance-changing operations must eventually be represented through immutable ledger transactions and entries.

Examples include:

- signup allocation
- faucet claim
- realized PnL
- trading fees
- funding
- liquidation effects

Retries must not cause duplicate financial effects.

## Concurrency

Critical financial state transitions must use PostgreSQL transactions and appropriate row-level locking.

Important race conditions include:

- simultaneous signup-allocation initialization
- simultaneous faucet claims
- concurrent orders using the same available margin
- simultaneous mutation of the same position
- liquidation versus user order
- duplicate execution attempts

Use a consistent lock order when multiple entities are involved.

Conceptual lock order:

`paper_account FOR UPDATE -> instrument FOR SHARE -> trading_position FOR UPDATE -> trade_order FOR UPDATE`

Cancellation locks only the order row. Catalog sync does not acquire paper-account, position, or order locks.

## Idempotency

Retriable financial operations must be idempotent.

Examples:

- signup allocation
- faucet claim
- order creation
- execution
- liquidation
- funding settlement

The rule is:

Retries must not create another financial effect.

## Market Data

The React frontend must not use Binance directly for trading decisions.

Market data flows through the backend. Browser UIs may consume Notional `GET /ws/market` or authenticated REST market-data; they must not open a Binance socket of their own.

WebSockets are not financially authoritative. REST remains the source of truth for persisted account, order, position, execution, funding, and liquidation state. After reconnect the client must REST-resync. Private sockets stream invalidation hints, not authoritative DTO copies.

Opening or reconnecting `GET /ws/account` is not an initialization path. It must not create a paper account, allocate signup credit, claim faucet, or write the ledger. Uninitialized users are rejected with `409 ACCOUNT_NOT_INITIALIZED`. The React SPA bootstraps the paper account with REST (`GET /api/account`, then `POST /api/account/initialize` on that 409) and must not treat `/ws/account` handshake HTTP statuses as a control flow; the browser cannot read them.

The React frontend must not compute margin, unrealized PnL, liquidation price, available balance, equity, or tick/step financial arithmetic. Signed position quantity is displayed from the decimal string (`-` prefix is SHORT). Wallet `balance` is labeled as wallet balance, not equity.


A committed financial transaction stays committed even if realtime publication fails. Realtime is best-effort notification.

Stale market data must not be used to:

- execute new market orders
- trigger limit orders
- trigger liquidation

If market data is stale, trading should pause.

Price sources are not interchangeable:

- a future paper MARKET BUY uses a fresh best ask
- a future paper MARKET SELL uses a fresh best bid
- unrealized PnL, liquidation, and margin/risk use a fresh mark price
- funding uses Binance USD-M realized `fundingRate` history and the exact preceding 1-minute mark-price kline; live `nextFundingTime` is a schedule hint only
- index price is reference only and is never an execution price

There is no generic authoritative `price`.

Live market state is ephemeral and process-local. PostgreSQL must not store mark, index, bid/ask, funding rate, or other live prices. Redis is not used for market data in Phase 7.

Mark freshness and BBO freshness are independent. Stale BBO must not internally invalidate a fresh mark. A future execution request may require fresh BBO while a risk request requires fresh mark.

Local freshness uses receive time against a stale threshold, never the exchange event timestamp as the ageing clock. A duplicate mark event with the same event time must not refresh local freshness. BBO is ordered by Binance book update identity (`lastUpdateId` / `u`), not by event timestamps.

If the public market feed disconnects, cached snapshots may remain in memory but must age stale and fail closed.

Notional consumes public Binance USD-M market data only. No Binance API key, secret, signed request, or user-data stream.

## Instruments

The instrument catalog is the set of Binance USD-M linear perpetual contracts Notional allows users to paper-trade. Settlement and margin are USDT only.

Identity:

- `instrument.id` is the stable internal UUID
- later orders, executions, and positions reference `instrument.id`
- unique `symbol` is the canonical external identity and equals the Binance USD-M futures symbol

The catalog does not include a second `binance_symbol` column.

PostgreSQL stores static metadata (assets, status, exact price/quantity/notional filters). It does not store live prices, books, funding rates, or 24h statistics.

`ACTIVE` instruments may accept new OPEN/INCREASE/REVERSE exposure. `INACTIVE` instruments must not accept that exposure, but reduceOnly REDUCE/CLOSE and liquidation may still exit with a fresh BBO. Rows remain because positions and history may still refer to them. Do not delete instrument rows.

PRICE_FILTER values of `0` mean a disabled Binance sub-rule and must be persisted as `0`. Quantity lot-size filters remain positive. Minimum notional is a positive USDT decimal string.

Phase 7 ingests only contracts that satisfy all of:

- `contractType === "PERPETUAL"`
- `quoteAsset === "USDT"`
- `marginAsset === "USDT"`
- `underlyingType === "COIN"`

`underlyingType` is an external string. Unknown values do not qualify. TradFi (`TRADIFI_PERPETUAL`, equity, commodity, pre-market) and index underlyings are not Notional instruments.

Eligible + Binance `TRADING` maps to `ACTIVE`. Any other Binance status maps to `INACTIVE`. Never delete rows.

Catalog synchronization must use a fully validated eligible snapshot. If any eligible candidate is missing or has malformed PRICE_FILTER, LOT_SIZE, MARKET_LOT_SIZE, or MIN_NOTIONAL (`notional`), abort the cycle and leave PostgreSQL unchanged. An empty mapped catalog also aborts. The catalog transaction must `SELECT` all existing instrument rows `ORDER BY id ASC FOR UPDATE` before mutating them, then upsert existing symbols, INSERT genuinely new symbols only after those locks, and mark already-locked existing rows absent from the snapshot `INACTIVE`. Catalog sync must not lock `paper_account`, `trading_position`, or `trade_order`.

