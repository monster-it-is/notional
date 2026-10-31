# Notional

Notional is a paper-trading simulator for crypto USDⓈ-M perpetual futures. It lets users practice leverage, margin, market and limit orders, funding, liquidation, and long/short position management using virtual USDT and live public market data from Binance.

> **Important:** Notional is not a real exchange, broker, wallet, custody service, blockchain application, or real-money trading product. It never accepts real funds, holds assets, or places orders on Binance.

## What it includes

- React + TypeScript + Vite single-page trading interface
- Fastify + TypeScript API
- PostgreSQL database managed with Drizzle ORM
- Better Auth cookie-based sessions
- Public Binance USDⓈ-M market data
- Paper MARKET and LIMIT orders
- CROSS and ISOLATED margin modes
- Leverage from 1× to 100×
- Realized and unrealized PnL
- Funding payments and liquidation simulation
- Realtime market and account WebSockets
- Automatic 1,000 USDT virtual signup allocation
- 100 USDT virtual faucet with a 24-hour cooldown

## Architecture

This repository is a pnpm monorepo:

```text
apps/
  api/          Fastify backend and WebSocket server
  web/          React/Vite frontend
packages/
  contracts/    Shared API and realtime contracts
  db/           PostgreSQL schema, migrations, and persistence
  trading/      Deterministic trading and risk calculations
docs/           Architecture, domain rules, decisions, and development plan
```

PostgreSQL is the authoritative source for accounts, balances, orders, executions, positions, ledger entries, funding, and liquidations. Redis is included in the local Docker Compose file for future use but is not required by the application and is not financially authoritative.

The production topology is a static web application, one API process, PostgreSQL, and Binance public REST/WebSocket market data. The matcher, funding scanner, liquidation scanner, market store, and browser WebSockets run inside the API process, so multiple API replicas are not currently supported.

## Requirements

- Node.js 22 or newer
- pnpm 12.4.1
- Docker with Docker Compose

## Local setup

### 1. Configure environment variables

From the repository root:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
```

The default local configuration uses:

- API: `http://localhost:3000`
- Web app: `http://localhost:5173`
- PostgreSQL: `localhost:5433`
- Test PostgreSQL database: `localhost:5433/notional_test`

Before using the application, replace `BETTER_AUTH_SECRET` in `.env` with a secret of at least 32 characters.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Start PostgreSQL

```bash
pnpm docker:up
```

The Compose setup starts PostgreSQL and creates the test database. Redis is also started, but the application does not depend on it.

### 4. Run database migrations

```bash
pnpm db:migrate
```

### 5. Start the API and web app

In separate terminals:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Open `http://localhost:5173` in a browser. The API is available at `http://localhost:3000`.

To stop local infrastructure:

```bash
pnpm docker:down
```

## Useful commands

```bash
# Build every workspace
pnpm build

# Type-check every workspace
pnpm typecheck

# Run unit and integration tests
pnpm test

# Run lint checks
pnpm lint

# Check formatting
pnpm format:check

# Run browser end-to-end tests
pnpm test:e2e

# Open Drizzle Studio
pnpm db:studio
```

The test suite requires `TEST_DATABASE_URL`. The local Docker setup supplies the expected test database on port `5433`.

## Environment variables

The root `.env.example` contains the complete configuration. The most important values are:

| Variable                          | Purpose                                     |
| --------------------------------- | ------------------------------------------- |
| `DATABASE_URL`                    | PostgreSQL connection used by the API       |
| `TEST_DATABASE_URL`               | PostgreSQL connection used by tests         |
| `BETTER_AUTH_SECRET`              | Session signing secret; use a strong secret |
| `BETTER_AUTH_URL`                 | Canonical API/auth URL                      |
| `WEB_ORIGIN`                      | Allowed browser origin                      |
| `PORT`                            | API listening port                          |
| `FAUCET_AMOUNT`                   | Virtual faucet amount                       |
| `VITE_API_BASE_URL`               | API URL compiled into the web application   |
| `BINANCE_FAPI_REST_BASE_URL`      | Public Binance Futures REST endpoint        |
| `BINANCE_FAPI_MARKET_WS_BASE_URL` | Binance market WebSocket endpoint           |
| `BINANCE_FAPI_PUBLIC_WS_BASE_URL` | Binance public WebSocket endpoint           |

Never commit `.env` files, database credentials, authentication secrets, or provider-generated connection strings.

## Production notes

Build all workspaces:

```bash
pnpm -r build
```

Run the compiled production migration:

```bash
pnpm migrate:prod
```

Start the API:

```bash
node apps/api/dist/server.js
```

For production, configure HTTPS origins, a strong `BETTER_AUTH_SECRET`, the correct `DATABASE_URL`, and `VITE_API_BASE_URL` before building the web image. Use the compiled migrator rather than `drizzle-kit push`.

The reverse proxy must:

- Serve the SPA fallback for client-side routes
- Forward WebSocket upgrades for `/ws/market` and `/ws/account`
- Preserve the `Host`, `Origin`, and authentication cookie headers
- Route API requests to the API process

Health endpoints:

- `GET /health` — process liveness
- `GET /ready` — startup and database readiness

## Security and financial model

- All balances and financial state are virtual.
- PostgreSQL is the financial source of truth.
- The frontend does not make financial decisions.
- Trading calculations use exact decimal arithmetic rather than JavaScript `Number`.
- Authentication uses host-only, HttpOnly, SameSite=Lax cookies.
- Stale market data fails closed for financial operations.
- Binance is used only as a public market-data source.

## Documentation

Further technical details are available in:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/system-design.md`](docs/system-design.md)
- [`docs/domain-rules.md`](docs/domain-rules.md)
- [`docs/development-plan.md`](docs/development-plan.md)
- [`docs/decisions.md`](docs/decisions.md)

## License

This repository currently declares the ISC license in its package metadata. See `package.json` for the project’s current licensing declaration.
