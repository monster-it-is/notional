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

The LIMIT matcher is in-process in the single API process. It runs only when the in-memory market-data store accepts a newer BBO. Per symbol it coalesces ticks (one cycle in flight, at most one follow-up using newest state). PostgreSQL remains authoritative for orders, fills, positions, wallet, and ledger. Redis is not used for order matching or trading locks.
