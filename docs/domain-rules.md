# Domain Rules

## Product

Notional is a paper crypto perpetual futures trading simulator.

It is not a real exchange, custody platform, wallet, payment system, or real-money trading system.

Binance is used only as a market-data source.

The backend owns all simulated trading state and decisions.

## Account Model

- One user has exactly one paper trading account.
- The account collateral currency is USDT only.
- No multi-currency wallet system in MVP.
- No real deposits.
- No withdrawals.
- No admin funding workflow.

Database invariant:

- one user -> one paper account

## Signup Allocation

Every new user receives exactly 1,000 USDT of virtual balance when the paper account is created.

The creation of:

- user
- paper account
- ledger account
- funding event
- ledger transaction
- ledger entries
- balance projection

must eventually be atomic when this feature is implemented.

## Faucet

Users can claim virtual USDT through a faucet.

Rules:

- one successful claim per 24 hours
- faucet amount is application configuration
- each successful claim must be persisted
- rejected cooldown attempts must not create financial credits
- concurrent requests must never produce duplicate credits
- retrying the same logical request must not create another financial effect

## Financial Authority

PostgreSQL is authoritative for financial state.

Redis must never be authoritative for:

- balances
- ledger
- orders
- executions
- positions
- liquidation state
- funding history
- faucet history

If Redis is lost, financial correctness must remain intact.

## Financial Arithmetic

Never use JavaScript `Number` as the canonical representation for financial values.

Use exact decimal arithmetic, such as `decimal.js`.

Persist financial values using PostgreSQL `NUMERIC`.

This applies to:

- balances
- prices
- quantities
- PnL
- margin
- fees
- funding
- liquidation calculations

Avoid unnecessary intermediate rounding.

## Position Model

For MVP, use one net position per account and instrument.

Database invariant:

- unique `(account_id, instrument_id)`

Use signed quantity:

- positive = long
- negative = short
- zero = flat

Do not implement hedge mode in MVP.

## Orders

Initial order types:

- Market
- Limit

The schema may support multiple executions per order, but MVP does not implement true partial fills.

Do not implement a matching engine.

Orders may support `reduceOnly`.

A reduce-only order must never increase exposure or cross through zero into a new opposite-side position.

## Margin

Supported:

- isolated margin
- cross margin
- user-selectable leverage

There are no margin tiers.

Do not introduce:

- risk tiers
- notional tiers
- position-size tiers
- tier-based leverage
- tier-based maintenance margin

Use one deterministic configurable risk model.

## PnL

For linear USDT-margined perpetuals:

Notional:

`abs(position quantity) * reference price`

Initial margin:

`notional / leverage`

Using signed quantity:

`unrealized PnL = signed quantity * (mark price - entry price)`

Mark price is used for:

- unrealized PnL
- liquidation
- margin/risk calculations

## Liquidation

Liquidation must use a deterministic documented model.

Do not claim to reproduce Binance's complete internal liquidation system.

Financial liquidation changes must eventually occur atomically inside a database transaction.

Risk must be re-checked after acquiring required database locks.

## Ledger

The ledger is the immutable explanation of financial changes.

The paper-account balance is a current projection for fast reads.

Do not model financial correctness as only:

`balance = balance + amount`

Balance-changing operations must eventually be represented through immutable ledger transactions and entries.

Examples include:

- signup allocation
- faucet claim
- realized PnL
- trading fees
- funding
- liquidation effects

Retries must not cause duplicate financial effects.

## Concurrency

Critical financial state transitions must use PostgreSQL transactions and appropriate row-level locking.

Important race conditions include:

- simultaneous faucet claims
- concurrent orders using the same available margin
- simultaneous mutation of the same position
- liquidation versus user order
- duplicate execution attempts

Use a consistent lock order when multiple entities are involved.

Conceptual lock order:

`account -> position -> order`

## Idempotency

Retriable financial operations must be idempotent.

Examples:

- signup allocation
- faucet claim
- order creation
- execution
- liquidation
- funding settlement

The rule is:

Retries must not create another financial effect.

## Market Data

The React frontend must not use Binance directly for trading decisions.

Market data flows through the backend.

Stale market data must not be used to:

- execute new market orders
- trigger limit orders
- trigger liquidation

If market data is stale, trading should pause
