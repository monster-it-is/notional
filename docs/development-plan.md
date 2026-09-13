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

Status: NOT STARTED

Phase 7 will fetch Binance USD-M `exchangeInfo`, keep only perpetual contracts with `quoteAsset === "USDT"` and `marginAsset === "USDT"`, map filters into `upsertInstrumentBySymbol`, and mark missing/non-tradable known symbols `INACTIVE`. Live prices, books, and funding feeds stay off the `instrument` table.


## Phase 8 — Trading Mathematics

Status: NOT STARTED

## Phase 9 — Orders

Status: NOT STARTED

## Phase 10 — Executions

Status: NOT STARTED

## Phase 11 — Positions

Status: NOT STARTED

## Phase 12 — Margin and Leverage

Status: NOT STARTED

## Phase 13 — Order / Position Integration

Status: NOT STARTED

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
