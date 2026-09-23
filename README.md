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

1. Set production env (https `BETTER_AUTH_URL` and `WEB_ORIGIN`, strong `BETTER_AUTH_SECRET`, real `DATABASE_URL` including `sslmode` if the host requires it). If the app user cannot `CREATE SCHEMA`, set `MIGRATION_DATABASE_URL` for the compiled migrator only.
2. `pnpm -r build`
3. `pnpm migrate:prod` (compiled Drizzle SQL migrator; never `drizzle-kit push`)
4. `node apps/api/dist/server.js` or the API Docker image entrypoint (migrate then `exec node dist/server.js`)

`TRUST_PROXY` defaults to false and accepts only `false` or `true`. Numeric values are rejected. The Northflank demo keeps it false until a separate reviewed client-IP design.

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

## Northflank demo (Phase 18B)

Status: **in progress**. Phase 18A remains the production-hardening baseline. Phase 18B.2 is repository configuration only. It does not create a Northflank account, provider resources, DNS, or a deploy. There is no Northflank template in the repo yet.

This is a **public portfolio / demo** on the Northflank Developer Sandbox. Provider docs do not position that sandbox as production hosting. Recurring hosting cost is a hard **$0**.

Browser origin is only the public `notional-web` hostname. `notional-api` has no browser hostname. nginx proxies `/api`, `/api/`, `/health`, `/ready`, `/ws/market`, and `/ws/account` to the private address `notional-api:3000`.

Conceptual values after Northflank assigns the web port (do not invent the hostname):

```text
WEB_ORIGIN=https://<northflank-web-dns>
BETTER_AUTH_URL=https://<northflank-web-dns>
VITE_API_BASE_URL=https://<northflank-web-dns>
```

The session cookie stays host-only, HttpOnly, Secure, SameSite=Lax, Path=/, with no `Domain` attribute.

`VITE_API_BASE_URL` is a web image **build** argument. The public DNS does not exist until the web port exists, so bootstrap is two manual provider steps. Those `.invalid` values are not source-controlled runtime config.

1. Create the API with `WEB_ORIGIN=https://web.invalid` and `BETTER_AUTH_URL=https://web.invalid`. Build the web image with `VITE_API_BASE_URL=https://web.invalid` so the public port can be created.
2. Copy the generated web port DNS. Rebuild web with `VITE_API_BASE_URL=https://<actual-web-dns>`. Set the API runtime origins to that same URL. Rebuild/redeploy web and restart/redeploy the API.

Ports: API container `3000`, HTTP, private (`public=false`, `vpcAccessible=false`). Northflank can auto-detect `EXPOSE 3000` as public; confirm the API port shows private before treating the demo as valid. Web container `80`, HTTP, public. That is the only public browser endpoint.

PostgreSQL 17: one addon, one replica, TLS on, public accessibility off. A runtime secret group scoped only to `notional-api` aliases `POSTGRES_URI` to `DATABASE_URL` when the names differ. Alias `POSTGRES_URI_ADMIN` to `MIGRATION_DATABASE_URL` for the API image entrypoint migrator only. The long-running API uses `DATABASE_URL`. Do not inherit either URI into builds or `notional-web`. Use the provider URIs unchanged: no `DATABASE_SSL`, no `NODE_TLS_REJECT_UNAUTHORIZED`, no `rejectUnauthorized: false`, no hand-added `sslmode`. If that URI cannot be consumed with TLS verification left on, stop. Local maintenance is Northflank addon forwarding, not a public database.

`TRUST_PROXY=false`. nginx forwards `Host`, `Origin`, and `Cookie`, and strips `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `Forwarded`. Per-IP auth and WebSocket rate limits therefore share the private hop address. A client-IP design is a later reviewed change.

Sandbox limits: Developer Sandbox plan, 2 services, 1 addon, 0 jobs, 0 extra volumes, 0 BYOC, 1 instance each, no autoscaling, no paid networking, no public database. Every create screen must show `$0` / included allocation. A non-zero price means stop. Do not pick a cheaper paid plan, upgrade, or switch to Pay-as-you-go. A card required for identity verification does not authorize paid resources. Final verification includes a billing page at projected spend `$0`. If the free allocation cannot run Notional, stop. OCI Always Free is only a later fallback decision, not the selected host.

See ADR-040. ADR-039 records the earlier Render choice and is superseded. ADR-038 remains the provider-independent operations architecture.
