# Wallet Cost Basis Plan

Status: PLANNED
Created: 2026-09-08
Owner: backend + desktop local store
Supersedes: the per-investment `funding_mode` model described in `docs/fee-settings-plan.md` §4

## 1. Why the current model cannot work

`investments.funding_mode` is an `ENUM('cash_in','wallet_funded') NOT NULL DEFAULT
'wallet_funded'`. `FeeCalculationService::resolveAcquisitionFees()` adds deposit
fee + FX fee + fixed deposit fee to a position's cost basis **only** when it reads
`cash_in`.

Three findings make that model unbuildable as specified:

### 1.1 The question has no answer

A marketplace wallet is a fungible pool. A wallet holding 200 € — 120 € from
deposits, 80 € from item sales — that pays for a 50 € purchase cannot say *which*
euros were spent. `funding_mode` forces a binary answer to a question that is
genuinely continuous.

### 1.2 Nothing can ever populate it

- `CsFloatTradeSyncService::…` writes `'fundingMode' => 'wallet_funded'` as a
  literal (`backend/src/Application/Service/CsFloatTradeSyncService.php:338`).
- `CsFloatTradeClient` calls `/v1/me/trades`, `/v1/me/buy-orders` and
  `/v1/me/watchlist` — there is **no transactions or deposits endpoint** in the
  client at all.
- No frontend surface writes the field. It is read in exactly three places
  (`InventoryTable`, `ItemDetailsModal`, `ItemDetailPanel`) and written in none.

Measured on a real desktop database (2026-09-08): **227 of 227 positions are
`wallet_funded`, zero are `cash_in`.** That is not a data gap, it is the
predictable outcome of a field only manual entry could fill, one position at a
time, forever.

### 1.3 It multiplies the fixed deposit fee

`resolveAcquisitionFees()` adds `depositFeeFixedEur` — a cost incurred **once per
deposit** — to **every** `cash_in` position. Ten purchases funded by one deposit
would charge the fixed fee ten times. The bug is latent only because no row is
`cash_in`.

## 2. Target model: a blended wallet cost factor

Stop attributing funding per position. Track what enters the wallet, and derive a
weighted-average cost factor — the same treatment a broker gives a cash account.

```
factor(t) = cash actually paid to fund the wallet, up to t
            ─────────────────────────────────────────────
            credit that reached the wallet, up to t
```

- Deposit 100 € at 3 % + 0.35 € → 103.35 € paid for 100 € credit.
- Sale proceeds of 80 € add 80 € credit at 80 € cost: the deposit friction was
  already paid when *that* item was bought, so counting it again would
  double-count. Sales therefore pull the factor toward 1.0.
- A purchase's cost basis is `totalInvested × factor(purchased_at)`.

Properties this buys:

| | per-position `funding_mode` | blended factor |
|---|---|---|
| Answerable from facts | no | yes |
| Automatable | no (no API surface) | yes (deposits are few and importable) |
| User effort | one decision per position | a handful of deposits per year |
| Fixed deposit fee | counted once per position | counted once per deposit |

## 3. What the rework touches

### 3.1 The narrow part

Cost basis has a single seam. `PortfolioService.php:147-149`:

```php
$acquisitionFees = $this->resolveAcquisitionFees($totalInvested, $fundingMode, $feeSettings);
$costBasisTotal  = $totalInvested + $acquisitionFees;
$costBasisUnit   = $quantity > 0 ? ($costBasisTotal / $quantity) : 0.0;
```

Every other cost-basis consumer reads `costBasisTotal` off the row. Replacing the
right-hand side is a contained change.

### 3.2 The wide part — the blocker

The factor needs the **complete wallet event stream in date order**, and that
stream does not currently exist anywhere it could be read from:

- **Deposits** are not modelled at all — no table, local or server.
- **Sales are not tracked anywhere.** This is worse than an earlier draft of this
  document claimed ("exists only server-side"). The truth:
  - `SaleRepository` declares `sales` and `sale_allocations` tables, but the class
    has **zero references** in the codebase — it is never instantiated, never
    registered in either DI container, never routed. `ensureTable()` is never
    called, so the tables are never even created.
  - Both importers bring in *purchases*, not sales.
    `DesktopSkinBaronController` reports `'type' => 'purchases'` and works on
    `purchaseGroups` / `purchaseItems`; the component named
    `SkinBaronSalesSyncModal` is misnamed.
  - No frontend surface records a sale. `wrapped.json` states the consequence
    plainly: "Unrealised performance of the positions you currently hold."

So the portfolio has no concept of a closed position. Everything is an open
holding, and every ROI figure is unrealised.

**Consequence: building the factor before the stream is complete produces a
silently wrong cost basis on every position whenever a sale is missing from the
denominator.** That is worse than today's uniformly-gross figure, which is at
least consistently wrong in one direction and can be labelled as such.

### 3.3 New sync entity

`operations_log` and `SyncEntityService` know exactly two entity types —
`investment` and `watchlist_item`. A `wallet_deposit` entity needs:

- local SQLite table + schema version bump (currently 4, `apps/desktop/src/localStore/index.js`)
- `operations_log` writes for idempotent push
- server table + repository
- `SyncEntityService` mapping and merge rules
- `docs/sync-api.md`, `docs/local-db-schema.md`, `AGENTS.md` and
  `docs/architecture-overview.md` updated in the same commit (documentation
  governance)

## 4. Staging

**Phase 0 — done (2026-09-08).** The inert Wallet / Cash-In filter chips were
removed from `PortfolioInventorySection`; they advertised a model this document
retires. `funding_mode` stays in the schema and in sync: it is harmless, and the
fee service still reads it.

**Phase 1 — sell tracking.** Not a preparatory step but a feature in its own
right, and the largest part of this plan: capturing a sale, allocating it against
held positions, reducing the holding, and reporting realised P&L beside the
unrealised figure. Local table, sync entity, server table, and a capture surface
(manual first; the CSFloat `/v1/me/trades` payload already distinguishes buy from
sell, so an importer can follow).

This is the same feature the design already anticipates, and parts of it were
built ahead and left unused:

| Built | Where | Used by |
|---|---|---|
| `SaleRepository` (+ `sale_allocations`) | `backend/src/Infrastructure/Persistence/Repository/` | nothing |
| `MetricPairBlock` / `MetricPairInline` | `packages/shared/src/components/MetricPair.jsx` | the design catalogue only — its specimen is titled "Verkaufserlös" |
| "Verkauft" filter scope | `DesignSystemPage.jsx:1036`, marked `soon` | not wired to a real view |
| `calculateNetProceeds()` | `FeeCalculationService` | used, but only for the *hypothetical* net value of a held position |

### Phase 1 decisions (2026-09-08)

**Allocation: FIFO at row level.** The schema is already lot-level — a Steam sync
writes one row per physical item, each carrying its own `buy_price_usd` and
purchase date, and `buildPositionLots` bundles them for display only ("the
underlying rows are untouched"). Measured on a real database: 227/227 rows have a
purchase date, 211 have a price, and 184 of 227 have `quantity = 1`.

FIFO is therefore *cheaper* than average cost here, inverting the usual
trade-off: it is a sort and a walk over the oldest unsold rows, and for 81 % of
rows needs no allocation record at all. Average cost would mean discarding
per-row cost the database already holds, and would produce a realised figure that
cannot be reconciled against a marketplace statement. The 43 rows with
`quantity > 1` need a partial consumption record — which is what
`sale_allocations` in the dead `SaleRepository` is already shaped for — and the
management UI already carries a "split position" concept to build on.

**Capture: importer-first, manual as the general fallback.** CSFloat and
SkinBaron are the primary path (`/v1/me/trades` already returns both sides; the
importer reads only the buy side today). A manual form covers Steam Market, P2P
and anything else, and writes through the same path so there is one write
strecke, not two.

**Sequencing consequence:** the "sold" filter scope that reads as a small
`soon` item is downstream of this phase, not independent of it — and so is the
wallet factor, which needs sale proceeds as the denominator of its credit side.

### Phase 1 open item: the server read path still shows unreduced holdings

The desktop reduces holdings by what sales consumed (`applySoldQuantities` in
`desktopDataMerge.js`, applied where the local snapshot is built).
`InvestmentRepository::findAll` — the single query behind every server-side
portfolio read — does **not**, so a web client would show a sold position at its
full quantity.

The fix is a `LEFT JOIN` on a grouped `sale_allocations` subquery, subtracting
`SUM(quantity)` and dropping rows that reach zero. It is small, but it carries a
hazard that makes it a deliberate step rather than a drive-by:

> `sale_allocations` only exists on a server once `ensureSalesTable()` has run,
> which happens on the first sync push. `InvestmentRepository::ensureTable()`
> does not create it. A `LEFT JOIN` against a missing table is a hard SQL error,
> so shipping this without guaranteeing the table exists would break **every**
> portfolio read on any server that has never received a sale.

So it needs either an ordering guarantee (ensure the sales tables wherever
investments are ensured) or an existence check, and it needs a live database to
verify against — `node:sqlite` cannot stand in for MySQL here.

**Phase 2 — deposits as a first-class entity.** Table, sync entity, and a desktop
entry surface (amount, date, fee, FX rate). Manual entry first; a marketplace
transaction import can follow where an API exposes one.

**Phase 3 — the factor.** A service that replays deposits and sales in date order
and answers `factor(t)`. Wire it into `PortfolioService.php:147` in place of
`resolveAcquisitionFees()`. Keep gross and net side by side, as the fee plan
already requires.

**Phase 4 — retire `funding_mode`.** Once the factor is authoritative, drop the
column's read path (`FeeCalculationService::resolveAcquisitionFees`) and the three
badge call sites, then the column itself.

## 5. Acceptance criteria

1. A deposit recorded on desktop reaches the server through `operations_log` and
   survives a pull on a second client.
2. `factor(t)` is 1.0 for a wallet funded entirely by sales proceeds, and
   `(deposit + fees) / deposit` for a wallet funded entirely by one deposit.
3. The fixed deposit fee appears exactly once per deposit in the aggregate cost
   basis, regardless of how many positions that deposit funded.
4. Cost basis for a portfolio with no recorded deposits equals `totalInvested` —
   i.e. the rework is a no-op until the user supplies wallet data.
5. Gross and net figures remain available side by side on every surface.

## 6. Decided: one factor per platform (2026-09-09)

CSFloat, SkinBaron and the Steam wallet are separate pools with separate fee
profiles, so the factor is `factor(platform, t)`, not one blended number.
Consequences the implementation has to carry:

- **Deposits carry a platform.** A deposit funds one marketplace wallet; it never
  raises the cost of items bought elsewhere.
- **A sale credits the wallet it happened on, and a purchase draws from the
  wallet it happened on** — which are not always the same wallet. An item bought
  on CSFloat and sold on SkinBaron takes its cost basis from CSFloat's factor at
  purchase time and adds its proceeds to SkinBaron's credit side. Treating the
  two as one pool is exactly the error this decision avoids.
- **A platform with no recorded deposits has factor 1.0.** Unknown-but-neutral,
  which keeps acceptance criterion 4 true: a portfolio with no wallet data has a
  cost basis equal to `totalInvested`.
- `investments.platform` and `sales.platform` already exist and are normalised
  (`normalizePlatform`), so the grouping key is available on both sides.
- The Steam wallet is a special case worth naming: it cannot be withdrawn from,
  so money entering it is effectively spent on the platform. That does not change
  the factor's arithmetic, but it does mean a Steam deposit is never recoverable
  and the distinction may matter for how the figure is *presented*.

## 7. Open questions

1. Does the wallet balance itself need to be a tracked figure, or is the factor
   enough? A balance would let the app reconcile against the marketplace and
   catch a missing deposit. Per-platform factors make this more valuable, not
   less: there are now three places a missing deposit can silently distort a
   cost basis instead of one.
2. Is a deposit ever *withdrawn* again? A withdrawal removes credit that was
   paid for, so ignoring it would leave the factor overstated for everything
   bought afterwards.
