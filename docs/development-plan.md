# Development Plan

## Phase 0 — Repository Setup

Status: COMPLETE

## Phase 1 — Database Foundation

Status: COMPLETE

## Phase 2 — Authentication

Status: COMPLETE

## Phase 3 — Paper Account

Status: COMPLETE

## Phase 4 — Signup Allocation + Ledger Foundation

Status: COMPLETE

## Phase 5 — Faucet

Status: COMPLETE

Phase 5 added `POST /api/account/faucet`, a 24-hour cooldown evaluated with PostgreSQL `clock_timestamp()` after row lock, configurable `FAUCET_AMOUNT`, `FAUCET_CLAIM` ledger/funding history, and `GET /api/account/funding`.

## Phase 6 — Instruments

Status: COMPLETE

Phase 6 added the PostgreSQL `instrument` catalog: UUID identity, canonical Binance USD-M `symbol`, exact PRICE_FILTER / LOT_SIZE / MARKET_LOT_SIZE / MIN_NOTIONAL decimals, `ACTIVE`/`INACTIVE` lifecycle, `upsertInstrumentBySymbol` (`INSERT ... ON CONFLICT (symbol)`), and authenticated `GET /api/instruments` plus `GET /api/instruments/:symbol`. The table is empty until Phase 7 sync. Live market data is not stored here.

## Phase 7 — Binance Market Data

Status: COMPLETE

Phase 7 synchronizes the instrument catalog from public Binance USD-M `exchangeInfo` (COIN USDT perpetuals only) in one PostgreSQL transaction, and keeps live mark/index/funding plus BBO in an in-process store. REST bootstrap uses `/fapi/v1/premiumIndex` and `/fapi/v1/ticker/bookTicker`. WebSockets use `/market` `!markPrice@arr@1s` and per-symbol `/public` `@bookTicker`. Authenticated `GET /api/market-data/:symbol` and `GET /api/market-data/status` expose Notional snapshots. Live prices are not stored in PostgreSQL. `/health` remains process+database liveness only.


## Phase 8 — Trading Mathematics

Status: COMPLETE

Phase 8 added `@notional/trading`: pure deterministic exact-decimal math for linear USDT perpetuals. It owns signed net-position fill application, realized/unrealized PnL, notional, tick/step/min-notional filter checks, and explicit `NUMERIC(38,18)` quantization. Precision 80 covers one transition from bounded committed `NUMERIC(38,18)` inputs. Quantities and execution prices are never rounded to fit. Derived average entry and realized PnL are quantized only at persistence with `ROUND_HALF_EVEN`. The generic min-notional helper does not fetch prices: Phase 9 LIMIT MIN_NOTIONAL uses the limit price, MARKET MIN_NOTIONAL uses fresh mark; MARKET execution remains best ask (BUY) / best bid (SELL). No PostgreSQL, API routes, environment variables, or market I/O.

## Phase 9 — Orders

Status: COMPLETE

Phase 9 added PostgreSQL `trade_order`: UUID identity, paper-account and instrument RESTRICT FKs, MARKET/LIMIT with CHECK-enforced price and status rules, `reduce_only`, per-account idempotency, history and OPEN-LIMIT matcher indexes, and no physical deletes. Public HTTP is read-only (`GET /api/orders`, `GET /api/orders/:id`). There is no public POST or cancel, no MARKET queue, no matching, no positions, and no margin. API validation uses `@notional/trading` filters: LIMIT MIN_NOTIONAL uses the limit price without market data; executable MARKET validation requires a fresh mark for MIN_NOTIONAL and a fresh BBO for the future fill path. Phase 13 owns atomic public placement.

## Phase 10 — Executions

Status: COMPLETE

Phase 10 added PostgreSQL `execution`: UUID identity, unique `order_id` (one complete fill per order), positive quantity/price, and UTC-naive `executed_at` sampled with `clock_timestamp()`. Production FILLED creation is `insertFilledOrderWithExecution` (MARKET and marketable LIMIT) or `completeOpenLimitOrder` (resting OPEN LIMIT). `insertOpenLimitOrder` creates LIMIT `OPEN` only. `@notional/trading` owns MARKET ask/bid and LIMIT BBO marketability/price-improvement helpers. Authenticated read-only `GET /api/executions` and `GET /api/executions/:id` are account-scoped. There is no public fill mutation, matcher, margin, or ledger trading effect. Internal fill helpers do not make the product tradable. Positions, margin, and accounting remained Phases 11–13.

## Phase 11 — Positions

Status: COMPLETE

Phase 11 added PostgreSQL `trading_position`: one persistent row per paper account and instrument, signed quantity, canonical flat `quantity = 0` / `entry_price` NULL, and cumulative lifetime `realized_pnl`. Flat rows are never deleted. `@notional/trading` quantizes derived entry and realized delta at persist (`toPersistedFillState` / `addNumeric3818Exact`); quantity is never rounded. Fill application uses `execution.price` inside one `FinancialTransaction` after `paper_account → trading_position → trade_order` locks. Only `created_filled` applies position effects; `replayed_filled` does not. `OPEN` plus a pre-existing execution is `EXECUTION_CONFLICT`, not a heal. Authenticated read-only `GET /api/positions` and `GET /api/positions/:symbol` expose open positions (`cumulativeRealizedPnl`, no unrealized PnL, no mutation routes). Phase 11 does **not** make trading financially complete: margin, account-balance realized PnL, and ledger integration remain Phase 12/13.

## Phase 12 — Margin and Leverage

Status: COMPLETE

Phase 12 extends `trading_position` with `margin_mode` (default `CROSS`), integer `leverage` `1..100` (default `1`), and `isolated_margin` (default `0`), plus CHECKs including CROSS isolated margin zero and ISOLATED open requiring positive isolated margin. `@notional/trading` adds exact collateral, available-balance, isolated-equity, required-isolated-margin, and caller-supplied maintenance primitives. Authenticated `GET`/`PUT /api/margin-settings/:symbol` mutate settings only while FLAT, under `paper_account → trading_position` locks. GET without a row returns `CROSS`/`1` without insert. Isolated fills throw `ISOLATED_FILL_NOT_IMPLEMENTED` and stay disabled through Phase 13. Wallet balance is still realized cash only; reservation does not move cash.

## Phase 13 — Order / Position Integration

Status: COMPLETE

Phase 13 enables public CROSS trading. `POST /api/orders` and `POST /api/orders/:id/cancel` run after CROSS margin checks, OPEN LIMIT `reserved_margin`, reduce-only placement and execution, exactly-once fill+position effects, wallet/insurance settlement, balanced `REALIZED_PNL` ledger, bankruptcy floor (`protectedBalance = 0`), replay-before-mutable-validation, stale-market fail-closed, one PostgreSQL transaction, in-process LIMIT matcher, and public cancel. Trading transactions SHARE-lock the instrument after the paper account so catalog inactivation cannot commit mid-trade. A newly created OPEN LIMIT schedules a matcher cycle after commit so a newer in-store BBO is not missed. Collateral requirements round **up**; PnL/wallet accounting stay HALF_EVEN. `reserved_margin` is placement-time only and is not a future-fill IM guarantee. Reduce-only exit-safety (waive LOT_SIZE / MIN_NOTIONAL for REDUCE/CLOSE; still PRICE_FILTER / BBO) is Notional policy, not Binance. Matcher insufficient margin, post-fill missing marks, and invalid reduce-only leave the order OPEN; expected matcher skip codes continue the symbol cycle. INACTIVE instruments reject new placement, do not match, and do not auto-cancel. Isolated fills stay `ISOLATED_FILL_NOT_IMPLEMENTED`. Isolated trading, liquidation, and maintenance remain Phase 14.

## Phase 14 — Liquidation

Status: NOT STARTED

## Phase 15 — Funding

Status: NOT STARTED

## Phase 16 — WebSockets

Status: NOT STARTED

## Phase 17 — React Trading Interface

Status: NOT STARTED

## Phase 18 — Testing, Hardening, and Deployment

Status: NOT STARTED
