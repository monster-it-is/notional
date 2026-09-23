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
- PostgreSQL TLS/SSL is configured in `DATABASE_URL` query options such as `sslmode`, according to the selected host. Phase 18A does not force a universal `sslmode`. There is no `DATABASE_SSL` setting and verification is not disabled.
- Production Node runs `node dist/server.js` after workspace `dist` builds. Compiled `migrate:prod` must run before start. Never `drizzle-kit push`.
- The production API image is built from `apps/api/Dockerfile` (multi-stage, `pnpm --filter=api --prod --legacy deploy`, non-root, migrate then `exec node dist/server.js`). The SPA image is `apps/web/Dockerfile` (nginx with `index.html` fallback). Images are not coupled. `docker-compose.prod.yml` is local image/wiring validation only; it uses placeholder HTTPS origins, not localhost HTTP.
- `GET /health` is liveness. `GET /ready` is traffic readiness (startup complete, not shutting down, Postgres reachable). Stale Binance data does not flip `/ready`; financial routes fail closed.
- Reverse proxies must allow WebSocket Upgrade on `/ws/market` and `/ws/account` and must not buffer those connections.
- SPA security headers (CSP, HSTS) are owned by the static/web host. Fastify applies API headers and optional HSTS when `ENABLE_HSTS` is on and `BETTER_AUTH_URL` is https.
- Rate limits are abuse protection only. The faucet 24h database cooldown remains financial authority.

## Northflank demo (Phase 18B)

Phase 18B is **in progress**, not complete. It is a zero-cost **public portfolio / demo** on the Northflank Developer Sandbox, not production-grade Northflank hosting. Phase 18A remains the production-hardening baseline. 18B.2 is repository configuration only: no account, resources, DNS, deploy, or provider manifest.

- Two services, one instance each, no autoscaling: `notional-web` (nginx, container port 80, public HTTP) and `notional-api` (Fastify, container port 3000, private HTTP, `public=false`, `vpcAccessible=false`). One PostgreSQL 17 addon. No Redis, jobs, extra volumes, or BYOC.
- The browser uses only the generated `notional-web` hostname. No purchased domain. nginx proxies `= /api`, `/api/`, `= /health`, `= /ready`, `= /ws/market`, and `= /ws/account` to `notional-api:3000` without stripping `/api`. Unknown `/api` paths stay Fastify responses. `/assets/*` is immutable and 404 when missing. Other paths fall back to `index.html`. Static responses send nosniff, `DENY`, `strict-origin-when-cross-origin`, a camera/microphone/geolocation Permissions-Policy, and HSTS `max-age=15552000`. No CSP yet. API headers still come from Fastify Helmet.
- Same-origin cookie: host-only, HttpOnly, Secure, SameSite=Lax, Path=/, no `Domain`. `WEB_ORIGIN`, `BETTER_AUTH_URL`, and build-time `VITE_API_BASE_URL` are all `https://<northflank-web-dns>`.
- Bootstrap is manual and two-stage because the web DNS is unknown until the public port exists. First API runtime origins and the first web build argument are `https://web.invalid`. After the port DNS exists, rebuild web and restart the API with `https://<actual-web-dns>`. `.invalid` is not committed as runtime config.
- `TRUST_PROXY` is `false` (`false` or `true` only). nginx forwards `Host`, `Origin`, and `Cookie`, and strips `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `Forwarded`. Client IP is not parsed. Auth and WebSocket IP rate limits share the private hop. A later client-IP change needs a measured edge and a separate review.
- Postgres: version 17, one replica, TLS on, public accessibility off. Runtime secret group for `notional-api` only. Alias `POSTGRES_URI` to `DATABASE_URL` if needed. Do not use `POSTGRES_URI_ADMIN`, do not inject the URI into builds or web, and do not add `DATABASE_SSL`, `NODE_TLS_REJECT_UNAUTHORIZED`, `rejectUnauthorized: false`, or a hand-written `sslmode`. If the generated TLS URI cannot be verified by `pg`, stop. Maintenance is addon port-forward.
- Docker `EXPOSE 3000` can be detected as a public port. The API port must be confirmed private before the demo is treated as valid. Do not add a second public API hostname.
- Recurring cost is `$0`. A create screen with a non-zero price is a stop. Do not upgrade or switch to Pay-as-you-go. A card used for identity verification does not authorize paid resources. Final verification includes projected provider spend `$0`. If free CPU/RAM cannot sustain the API, stop. OCI Always Free is not selected; it is only a possible later fallback.
- Migrations stay in the API image entrypoint. `/ready` is readiness and `/health` is liveness. Neither requires a public API port.
