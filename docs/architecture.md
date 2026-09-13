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

## Dependency Direction

web -> contracts

api -> contracts

api -> db

api -> trading

`@notional/trading` has no dependencies on api, db, contracts, or web.

Frontend must never import database models.

Frontend must never import `@notional/trading`. Trading math is backend domain logic; display values come from the API.
