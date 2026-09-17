# Notional

Paper crypto USD-M perpetual futures simulator. Not a real exchange, wallet, custody system, or real-money product. Binance is used only as a public market-data source.

Notional does not take real funds, provide custody, settle on a blockchain, or place orders on Binance.

## Stack and features

- React + TypeScript + Vite SPA
- Fastify API
- PostgreSQL + Drizzle
- Better Auth cookie sessions
- Binance public market data only
- MARKET and LIMIT paper orders
- CROSS and ISOLATED margin, with leverage
- Funding and liquidation
- Realtime WebSockets (`/ws/market`, `/ws/account`)
- Automatic 1,000 USDT signup paper allocation
- 100 USDT faucet with a 24-hour cooldown

## Local development

Requirements: Node 22+, pnpm 12.4.1, Docker.

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm dev:api
pnpm dev:web
```

API: `http://localhost:3000`. Web: `http://localhost:5173`.

`pnpm test` needs `TEST_DATABASE_URL` (created by `docker/postgres/init.sql`).

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## Production (Phase 18A)

Topology: static SPA + **one** API process + PostgreSQL + Binance public REST/WS. Redis is unused. Do not run multiple API replicas; matcher, scanners, market store, and WebSockets are in-process.

Cookie sessions are host-only, HttpOnly, SameSite=Lax, Path=/. Web and API must be same-site (same https origin via reverse proxy, or sibling https subdomains). Unrelated sites will not send Lax cookies.

Production start:

1. Set production env (https `BETTER_AUTH_URL` and `WEB_ORIGIN`, strong `BETTER_AUTH_SECRET`, real `DATABASE_URL` including `sslmode` if the host requires it).
2. `pnpm -r build`
3. `pnpm migrate:prod` (compiled Drizzle SQL migrator; never `drizzle-kit push`)
4. `node apps/api/dist/server.js` or the API Docker image entrypoint (migrate then `exec node dist/server.js`)

`TRUST_PROXY` defaults to false. Set it only after choosing a reverse-proxy provider (Phase 18B).

`GET /health` — process liveness, no database.
`GET /ready` — startup complete, not shutting down, Postgres reachable. Not gated on Binance freshness.

Reverse proxies must forward WebSocket upgrades for `/ws/market` and `/ws/account` without buffering. SPA hosts must serve `index.html` for client routes and should set their own CSP/HSTS. Fastify HSTS is controlled by `ENABLE_HSTS` when `BETTER_AUTH_URL` is https; it does not depend on `TRUST_PROXY`.

Build the web app with `VITE_API_BASE_URL` set to the public API origin (`https` derives `wss`).

Docker:

```bash
docker build -f apps/api/Dockerfile -t notional-api .
docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=https://api.example.test -t notional-web .
```

`docker compose -f docker-compose.prod.yml` is an API + PostgreSQL production-like wiring check. It builds the API image only; it does not build the web image. `up` uses placeholder HTTPS origins so production `parseEnv` can start; signing in through localhost is not a representative production auth flow.

A local `pnpm --filter=api --prod --legacy deploy ./tmp-out` verifies the pruned artifact. Restore the workspace afterward with `pnpm install` (deploy `--prod` can prune local devDependencies).
