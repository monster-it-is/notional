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
