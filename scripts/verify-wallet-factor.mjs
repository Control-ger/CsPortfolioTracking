#!/usr/bin/env node

/**
 * Wallet cost factor verification.
 *
 * The replay is pure arithmetic with no store or browser dependency, so it runs
 * directly under node. The cases mirror the worked examples in
 * docs/wallet-cost-basis-plan.md §2.1 — including the two that the superseded
 * cumulative formula got wrong, which is why they are pinned here.
 *
 * Run with `npm run verify:wallet`.
 */
import { buildWalletTimeline, replayWalletTimeline, costBasisByPurchaseId }
  from "../packages/shared/src/lib/walletFactor.js";

const fail = [];
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;
const check = (label, got, want) => {
  const ok = Array.isArray(want)
    ? want.every((w, i) => (typeof w === "number" ? near(got[i], w) : JSON.stringify(got[i]) === JSON.stringify(w)))
    : (typeof want === "number" ? near(got, want) : JSON.stringify(got) === JSON.stringify(want));
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); fail.push(label); }
};
const run = (input) => replayWalletTimeline(buildWalletTimeline(input));
const D = (n) => `2026-0${n}-01T00:00:00Z`;

// The plan's worked example. The old cumulative formula produced 0.47 here.
const worked = run({
  walletEvents: [{ id: "d1", platform: "csfloat", amountUsd: 100, feeUsd: 3.35, occurredAt: D(1) }],
  purchases: [{ id: "p1", platform: "csfloat", totalUsd: 100, purchasedAt: D(2) }],
  sales: [{ id: "s1", platform: "csfloat", netProceedsUsd: 120, soldAt: D(3) }],
});
const basis = costBasisByPurchaseId(worked);
check("deposit fee lands in the item's basis", basis.p1.costUsd, 103.35);
check("wallet is emptied by the purchase", worked.csfloat.balance, 120);
check("proceeds re-enter at face value", worked.csfloat.factor, 1);
check("factor never drops below 1", worked.csfloat.factor >= 1, true);

// A purchase funded by sale proceeds carries no deposit friction.
const fromProceeds = run({
  walletEvents: [{ id: "d1", platform: "csfloat", amountUsd: 100, feeUsd: 3.35, occurredAt: D(1) }],
  purchases: [{ id: "p1", platform: "csfloat", totalUsd: 100, purchasedAt: D(2) },
              { id: "p2", platform: "csfloat", totalUsd: 120, purchasedAt: D(4) }],
  sales: [{ id: "s1", platform: "csfloat", netProceedsUsd: 120, soldAt: D(3) }],
});
check("proceeds-funded purchase pays face value", costBasisByPurchaseId(fromProceeds).p2.costUsd, 120);

// The withdrawal case from the plan: drain, refill at a different rate.
const drained = run({
  walletEvents: [
    { id: "d1", platform: "csfloat", amountUsd: 1000, feeUsd: 0, occurredAt: D(1) },
    { id: "w1", platform: "csfloat", amountUsd: -100, feeUsd: 0, occurredAt: D(3) },
    { id: "d2", platform: "csfloat", amountUsd: 100, feeUsd: 10, occurredAt: D(4) },
  ],
  purchases: [{ id: "p1", platform: "csfloat", totalUsd: 900, purchasedAt: D(2) },
              { id: "p2", platform: "csfloat", totalUsd: 100, purchasedAt: D(5) }],
});
check("withdrawal keeps the factor unchanged", drained.csfloat.purchases[0].factor, 1);
check("refill at a new rate is honoured", costBasisByPurchaseId(drained).p2.costUsd, 110);

// Without the withdrawal the same sequence understates it — the reason
// withdrawals are modelled at all.
const noWithdrawal = run({
  walletEvents: [
    { id: "d1", platform: "csfloat", amountUsd: 1000, feeUsd: 0, occurredAt: D(1) },
    { id: "d2", platform: "csfloat", amountUsd: 100, feeUsd: 10, occurredAt: D(4) },
  ],
  purchases: [{ id: "p1", platform: "csfloat", totalUsd: 900, purchasedAt: D(2) },
              { id: "p2", platform: "csfloat", totalUsd: 100, purchasedAt: D(5) }],
});
check("omitting it understates the basis", costBasisByPurchaseId(noWithdrawal).p2.costUsd, 105);

// Platforms are separate pools.
const split = run({
  walletEvents: [{ id: "d1", platform: "csfloat", amountUsd: 100, feeUsd: 10, occurredAt: D(1) }],
  purchases: [{ id: "p1", platform: "skinbaron", totalUsd: 50, purchasedAt: D(2) }],
});
check("a deposit does not fund another platform", costBasisByPurchaseId(split).p1.costUsd, 50);
check("each platform has its own state", Object.keys(split).sort(), ["csfloat", "skinbaron"]);

// Bought on one platform, sold on another.
const crossed = run({
  walletEvents: [{ id: "d1", platform: "csfloat", amountUsd: 100, feeUsd: 10, occurredAt: D(1) }],
  purchases: [{ id: "p1", platform: "csfloat", totalUsd: 100, purchasedAt: D(2) }],
  sales: [{ id: "s1", platform: "skinbaron", netProceedsUsd: 120, soldAt: D(3) }],
});
check("cost comes from the buying platform", costBasisByPurchaseId(crossed).p1.costUsd, 110);
check("proceeds credit the selling platform", crossed.skinbaron.balance, 120);
check("the buying wallet is left empty", crossed.csfloat.balance, 0);

// A missing deposit drives the balance negative.
const missing = run({
  purchases: [{ id: "p1", platform: "csfloat", totalUsd: 500, purchasedAt: D(2) }],
});
check("a missing deposit is flagged", missing.csfloat.wentNegative, true);
check("balance is clamped, not negative", missing.csfloat.balance, 0);
check("basis falls back to face value", costBasisByPurchaseId(missing).p1.costUsd, 500);

// A reported balance re-bases the replay and names the drift.
const reconciled = run({
  walletEvents: [
    { id: "d1", platform: "csfloat", amountUsd: 100, feeUsd: 0, occurredAt: D(1) },
    { id: "r1", platform: "csfloat", amountUsd: 0, balanceAfterUsd: 60, occurredAt: D(2) },
  ],
});
check("drift is reported", reconciled.csfloat.discrepancies.length, 1);
check("drift size is right", reconciled.csfloat.discrepancies[0].drift, -40);
check("the reading wins", reconciled.csfloat.balance, 60);

// Same-instant ordering: a deposit must settle before what it funded.
const sameInstant = run({
  walletEvents: [{ id: "d1", platform: "csfloat", amountUsd: 100, feeUsd: 10, occurredAt: D(1) }],
  purchases: [{ id: "p1", platform: "csfloat", totalUsd: 100, purchasedAt: D(1) }],
});
check("a deposit settles before its purchase", costBasisByPurchaseId(sameInstant).p1.costUsd, 110);

// Importers write the row's source, not the wallet it was paid from. A Steam
// deposit must reach purchases the Steam importer labelled `steam_inventory`.
const pooled = run({
  walletEvents: [{ id: "d1", platform: "steam", amountUsd: 100, feeUsd: 10, occurredAt: D(1) }],
  purchases: [{ id: "p1", platform: "steam_inventory", totalUsd: 100, purchasedAt: D(2) }],
});
check("steam_inventory shares the steam wallet", costBasisByPurchaseId(pooled).p1.costUsd, 110);
check("it does not open a second pool", Object.keys(pooled), ["steam"]);

console.log(fail.length ? `\n${fail.length} FAILING` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
