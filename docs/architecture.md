# Architecture

## System Type

Notional is a paper crypto perpetual futures trading simulator.

It is not:

- a real cryptocurrency exchange
- a custody system
- a blockchain application
- a real-money trading platform

Binance is used only as a market-data source.

## Architecture

Frontend:
React + TypeScript + Vite

Backend:
Node.js + TypeScript + Fastify

Database:
PostgreSQL + Drizzle ORM

Cache / transient infrastructure:
Redis

Repository:
pnpm monorepo

## Application Architecture

The backend is a modular monolith.

PostgreSQL is authoritative for financial state.

Redis must never be authoritative for:

- balances
- positions
- orders
- executions
- ledger
- funding history
- liquidations

The frontend is never authoritative for financial decisions.

`apps/web` is a React + TypeScript + Vite SPA. Better Auth cookie sessions are the only browser authentication source. TanStack Query caches persisted REST reads. Zustand holds ephemeral `/ws/market` quotes and socket protocol status only. Local React state holds forms and UI. The SPA never imports `@notional/trading`, `@notional/db`, or API internals.

Authenticated bootstrap is REST: `GET /api/account`, then `POST /api/account/initialize` if uninitialized. `/ws/account` connects only after that bootstrap is READY. Native WebSocket `open` is not application-ready; both sockets wait for `hello` (`protocolVersion === 1`). Account reconnect invalidates private REST queries after hello because Phase 16 has no replay. Market reconnect resubscribes after hello. Browser JavaScript cannot inspect rejected WebSocket upgrade HTTP statuses.


## Dependency Direction

web -> contracts

api -> contracts

api -> db

api -> trading

`@notional/trading` has no dependencies on api, db, contracts, or web.

Frontend must never import database models.

The LIMIT matcher is in-process in the single API process. It runs only when the in-memory market-data store accepts a newer BBO. Per symbol it coalesces ticks (one cycle in flight, at most one follow-up using newest state). PostgreSQL remains authoritative for orders, fills, positions, wallet, ledger, and liquidations. Redis is not used for order matching, trading locks, or liquidation coordination.

The liquidation scanner is in-process in the API server runtime only (`server.ts`), not `buildApp`. It coalesces to one global scan at a time. Unlocked scan state is a trigger; every real liquidation rechecks under locks.

The funding scanner is also in-process in `server.ts` only, started after market data. It prepares realized history and `LiveScheduleProof` outside financial locks. User, matcher, liquidation, and faucet mutations SHARE-lock the union of funding-relevant and caller-target instruments `id ASC`, `ensurePosition` for first-ever targets, then lock positions `instrument_id ASC`. `financialNow` is sampled immediately after the account lock.

Any transaction that locks or mutates multiple existing instrument rows acquires them `instrument.id ASC`. Financial multi-symbol order is `paper_account FOR UPDATE` → instruments `id ASC FOR SHARE` → positions in that instrument order → orders. Catalog sync prelocks existing instruments `id ASC FOR UPDATE` and never locks account, position, or order rows.

Book-ticker subscriptions cover every known catalog symbol (ACTIVE and INACTIVE). Mark remains the all-catalog `!markPrice@arr@1s` stream. If Binance stops publishing a symbol, Notional has no BBO and liquidation/unwind fail closed.

Browser realtime is in-process only. `server.ts` creates one `RealtimeRuntime` and injects it into `buildApp`. `GET /ws/market` fans out coalesced store snapshots. `GET /ws/account` emits post-commit private invalidations. WebSockets are not financially authoritative; REST resync is required after reconnect. Redis is unused for realtime.
