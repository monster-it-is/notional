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
Redis is present in local docker-compose but **unused** by the application runtime. It is reserved for later non-authoritative scaling and must never be financial authority.

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

## Production operations

Production is a static SPA + one API process + PostgreSQL + Binance public REST/WS.

- Session cookies are host-only SameSite=Lax. Deploy web and API same-site (same origin via reverse proxy, or sibling https subdomains).
- HTTP CORS permits exactly the canonical `WEB_ORIGIN`. Better Auth `trustedOrigins` is exactly that origin. Browser WebSocket `Origin` must equal `WEB_ORIGIN`.
- PostgreSQL TLS/SSL is configured in `DATABASE_URL` query options such as `sslmode`, according to the selected host. Phase 18A does not force a universal `sslmode`. Render (Phase 18B) uses the same-region internal `connectionString` with no `sslmode` append, no `DATABASE_SSL`, and public database access disabled.
- Production Node runs `node dist/server.js` after workspace `dist` builds. Compiled `migrate:prod` must run before start. Never `drizzle-kit push`.
- The production API image is built from `apps/api/Dockerfile` (multi-stage, `pnpm --filter=api --prod --legacy deploy`, non-root, migrate then `exec node dist/server.js`). The SPA image is `apps/web/Dockerfile` (nginx with `index.html` fallback). Images are not coupled. `docker-compose.prod.yml` is local image/wiring validation only; it uses placeholder HTTPS origins, not localhost HTTP.
- `GET /health` is liveness. `GET /ready` is traffic readiness (startup complete, not shutting down, Postgres reachable). Stale Binance data does not flip `/ready`; financial routes fail closed.
- Reverse proxies must allow WebSocket Upgrade on `/ws/market` and `/ws/account` and must not buffer those connections.
- SPA security headers (CSP, HSTS) are owned by the static/web host. Fastify applies API headers and optional HSTS when `ENABLE_HSTS` is on and `BETTER_AUTH_URL` is https.
- Rate limits are abuse protection only. The faucet 24h database cooldown remains financial authority.

## Render (Phase 18B)

Phase 18B is **in progress**, not complete. Hosting is Render in **Singapore**: a static site (`notional-web`), one Docker web service (`notional-api` from `apps/api/Dockerfile`), and Render Postgres (`notional-db`). Redis is not provisioned.

- Steady-state API count is **one instance** (`numInstances: 1`, no autoscaling). Matcher, scanners, market store, and WebSocket fanout stay in-process.
- Render zero-downtime deploys may temporarily run the old API process and the new API process before traffic cutover and SIGTERM of the old process. `numInstances: 1` does not prevent that overlap. PostgreSQL locks and uniqueness remain financial authority.
- `GET /ready` is the Render health check. Graceful shutdown delay is 30 seconds. Migrations run only from the API Docker entrypoint (no `preDeployCommand`).
- `TRUST_PROXY` is `false` until provider `X-Forwarded-For` verification. Accepted values are `false` or `true` only (Fastify 5.12.4 does not support numeric hop counts).
- Final browser cookie authentication requires sibling custom https domains (`notional.<DOMAIN>` and `api.notional.<DOMAIN>`). `*.onrender.com` hostnames are provisioning and testing only; `onrender.com` is a public suffix. Custom domains and disabling onrender subdomains are later 18B subphases.
- Auto-deploy is off. GitHub Actions remains verification-only. `checksPass` is not enabled yet.
