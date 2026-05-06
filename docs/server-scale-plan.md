# Server Scale Plan

Status: IN PROGRESS
Date: 2026-05-06
Scope: MySQL backend architecture for 1,000 users with up to 20,000 items per user.

## 1) Problem Statement

Current runtime mixes three concerns:

1. Global item prices (same for all users)
2. User portfolio holdings
3. Hourly sync + API reads on the same hot path

At high cardinality this causes:

- expensive N+1 queries in request paths
- repeated external price fetch pressure
- large history growth without strict retention partition strategy
- redundant catalog storage (`items` + `item_catalog`)

## 2) Target Architecture

Design principle: item-centric pricing, user-centric holdings, async sync pipeline.

### 2.1 Canonical tables (core)

- `items`: global item catalog (single source for metadata)
- `item_price_latest`: one hot row per item
- `item_price_history_hourly`: append-only hourly price buckets
- `user_positions`: aggregated user holdings per item
- `position_events`: optional append-only event log (buy/sell/import/audit)
- `portfolio_snapshots_daily`: daily portfolio aggregates for charts

### 2.2 Non-canonical / optional tables

- `item_live_cache`: transitional only, remove after cutover to `item_price_latest`
- `item_catalog`: merge into `items`, then deprecate
- `position_history`: keep only if UI requires per-item time snapshots; otherwise derive
- `observability_events`: keep with strict retention + sampling

## 3) Scalability Model

### 3.1 Capacity assumptions

- users: 1,000
- max holdings per user: 20,000
- max rows in `user_positions`: 20,000,000

This is feasible with InnoDB if:

- all hot reads are index-backed
- write amplification is controlled (batch upserts)
- hourly price sync is based on unique `item_id`, not per user position

### 3.2 Critical insight

Price fetch workload scales with unique items, not with users.
If 20M positions map to 200k unique items, price sync pressure is manageable.
If unique items approach millions, provider rate limits become the limiting factor.

## 4) Runtime Rules

1. API requests never call external pricing providers directly.
2. Price workers write only to `item_price_latest` and `item_price_history_hourly`.
3. Portfolio reads join `user_positions` + `item_price_latest` (+ `items` metadata).
4. Writes from desktop/web append position events and update `user_positions` atomically.
5. Retention jobs run continuously for observability + old sync metadata.

## 5) Migration Strategy (No Big Bang)

Phase A (additive, safe):

- add new pricing and position aggregate tables
- keep old tables running
- backfill data from `investments` + `price_history`

Phase B (dual write + shadow read):

- sync workers write to old and new price tables
- API endpoints compare old/new read results in debug mode
- enable canary users on new read path

Phase C (cutover + cleanup):

- switch production reads to new tables
- stop writes to deprecated tables
- drop/archivate redundant tables after stability window

## 6) Table Classification From Current Schema

Keep as core:

- `users`
- `items`
- `watchlist`
- `exchange_rates`
- `user_fee_settings`

Keep with redesign:

- `investments` -> source for backfill and/or becomes `position_events`
- `price_history` -> migrate into `item_price_history_hourly` with proper time bucket
- `portfolio_history` -> replace by `portfolio_snapshots_daily`

Deprecate after cutover:

- `item_catalog` (metadata duplication)
- `item_live_cache` (replaced by `item_price_latest`)
- `position_history` (if not strictly required)

Operational:

- `sync_entities`, `sync_idempotency`, `sync_status` (keep if sync protocol is active)
- `cache_maintenance_logs` (keep, small)
- `observability_events` (keep with retention cap)
- `auth_state_tokens` (keep)

## 7) Performance Requirements

Required query profile after cutover:

- portfolio summary by user: index range scan on `user_positions(user_id, item_id)`
- live valuation: index nested join to `item_price_latest(item_id)`
- watchlist read: `watchlist(user_id, item_id)` + price latest join
- no full table scans in steady state endpoints

## 8) Risks and Mitigations

Risk: large backfill lock contention.
Mitigation: chunked backfill by primary key ranges + short transactions.

Risk: drift between old and new calculation paths.
Mitigation: shadow comparison endpoint + mismatch metrics before cutover.

Risk: explosive observability growth.
Mitigation: retention (`7-30 days`) + level/category sampling policy.

## 9) Immediate Next Implementation Steps

1. Apply additive SQL migrations in `backend/sql/migrations`.
2. Build backfill CLI script for:
   - `user_positions` from `investments`
   - `item_price_latest` from newest `price_history` row per item
3. Introduce repository layer for new tables.
4. Add feature flag for read-path cutover.
