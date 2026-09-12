# Architecture Decisions

## ADR-001 — PostgreSQL over MongoDB

Status: Accepted

Financial state is relational and transactional.
PostgreSQL is authoritative.

## ADR-002 — Modular Monolith

Status: Accepted

Backend begins as one Fastify application.
No microservices.

## ADR-003 — React + Vite

Status: Accepted

Frontend is a standalone React SPA.
Next.js is not required.

## ADR-004 — One Net Position Per Instrument

Status: Accepted

Position identity:
(account_id, instrument_id)

Signed quantity represents direction.

## ADR-005 — No Partial Fills in MVP

Status: Accepted

Schema supports multiple executions.
Initial execution engine produces one complete fill.

## ADR-006 — USDT-Only Collateral

Status: Accepted

No generalized wallet or multi-currency architecture.

## ADR-007 — No Margin Tiers

Status: Accepted

One configurable margin/risk model is used.
