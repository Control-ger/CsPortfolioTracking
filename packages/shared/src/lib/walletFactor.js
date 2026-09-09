/**
 * The wallet cost factor.
 *
 * Carries two running figures per marketplace — the wallet's `balance` and what
 * that balance cost to obtain — and reads `factor = balanceCost / balance` at
 * the moment a purchase happens. Full rationale, including why a cumulative
 * ratio does not work, in docs/wallet-cost-basis-plan.md §2.1.
 *
 * Pure: no store access, no network. The caller supplies the events.
 */

/** Below this a balance counts as empty, keeping float dust out of the factor. */
const BALANCE_EPSILON = 1e-6;

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizePlatform(value) {
  return String(value || "manual").trim().toLowerCase();
}

/** Sortable instant; unparseable dates sort last rather than crashing the fold. */
function instantOf(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * Merge every wallet-moving thing into one ordered stream per platform.
 *
 * Purchases belong here, not only deposits and sales: a purchase is what
 * *removes* credit, and leaving it out is exactly the mistake that made the
 * first draft of this model produce a factor below 1.0.
 */
export function buildWalletTimeline({ walletEvents = [], sales = [], purchases = [] } = {}) {
  const entries = [];

  for (const event of Array.isArray(walletEvents) ? walletEvents : []) {
    entries.push({
      kind: toNumber(event?.amountUsd) < 0 ? "withdrawal" : "deposit",
      platform: normalizePlatform(event?.platform),
      at: instantOf(event?.occurredAt),
      amountUsd: toNumber(event?.amountUsd),
      feeUsd: Math.max(0, toNumber(event?.feeUsd)),
      balanceAfterUsd:
        event?.balanceAfterUsd === undefined || event?.balanceAfterUsd === null
          ? null
          : toNumber(event.balanceAfterUsd),
      id: event?.id,
    });
  }

  for (const sale of Array.isArray(sales) ? sales : []) {
    entries.push({
      kind: "sale",
      platform: normalizePlatform(sale?.platform),
      at: instantOf(sale?.soldAt),
      // Net, not gross: the marketplace's cut never reaches the wallet.
      amountUsd: Math.max(0, toNumber(sale?.netProceedsUsd)),
      id: sale?.id,
    });
  }

  for (const purchase of Array.isArray(purchases) ? purchases : []) {
    entries.push({
      kind: "purchase",
      platform: normalizePlatform(purchase?.platform),
      at: instantOf(purchase?.purchasedAt),
      amountUsd: Math.max(0, toNumber(purchase?.totalUsd)),
      id: purchase?.id,
    });
  }

  // Deposits settle before whatever they funded on the same instant; a purchase
  // ordered ahead of its own deposit would draw from an empty wallet.
  const rank = { deposit: 0, sale: 1, purchase: 2, withdrawal: 3 };
  return entries.sort((left, right) =>
    left.at === right.at ? rank[left.kind] - rank[right.kind] : left.at - right.at,
  );
}

/**
 * Replay the timeline and report the factor for every purchase.
 *
 * Returns per platform: the final state, the factor applied to each purchase,
 * and any discrepancy the user's own balance readings exposed.
 */
export function replayWalletTimeline(timeline = []) {
  const platforms = new Map();

  const stateFor = (platform) => {
    if (!platforms.has(platform)) {
      platforms.set(platform, {
        platform,
        balance: 0,
        balanceCost: 0,
        purchases: [],
        discrepancies: [],
        wentNegative: false,
      });
    }
    return platforms.get(platform);
  };

  // factor = what the current balance cost per unit of credit. An empty wallet
  // has no factor of its own; 1.0 (cost equals face value) is the neutral
  // assumption and keeps a portfolio with no wallet data at its plain invested
  // total.
  const factorOf = (state) =>
    state.balance > BALANCE_EPSILON ? state.balanceCost / state.balance : 1;

  for (const entry of Array.isArray(timeline) ? timeline : []) {
    const state = stateFor(entry.platform);

    if (entry.kind === "deposit") {
      state.balance += entry.amountUsd;
      state.balanceCost += entry.amountUsd + entry.feeUsd;
    } else if (entry.kind === "sale") {
      // Proceeds re-enter at face value: the deposit friction that funded the
      // sold item was already paid, and charging it again would double-count.
      state.balance += entry.amountUsd;
      state.balanceCost += entry.amountUsd;
    } else if (entry.kind === "withdrawal" || entry.kind === "purchase") {
      const factor = factorOf(state);
      const leaving = entry.kind === "withdrawal" ? Math.abs(entry.amountUsd) : entry.amountUsd;
      const costLeaving = leaving * factor;

      if (entry.kind === "purchase") {
        state.purchases.push({ id: entry.id, at: entry.at, amountUsd: leaving, factor, costUsd: costLeaving });
      }

      state.balance -= leaving;
      state.balanceCost -= costLeaving;

      // A balance below zero means a deposit was never recorded. Clamping and
      // falling back to a neutral factor keeps later figures merely incomplete
      // rather than nonsensical — and the flag makes the gap sayable.
      if (state.balance < -BALANCE_EPSILON) {
        state.wentNegative = true;
        state.balance = 0;
        state.balanceCost = 0;
      }
    }

    if (entry.balanceAfterUsd !== null && entry.balanceAfterUsd !== undefined) {
      const drift = entry.balanceAfterUsd - state.balance;
      if (Math.abs(drift) > 0.01) {
        state.discrepancies.push({ at: entry.at, expected: state.balance, reported: entry.balanceAfterUsd, drift });
      }
      // The user's reading is ground truth. Adopting it keeps the cost per unit
      // of credit and re-bases the balance, so one forgotten event distorts the
      // stretch before the reading instead of everything after it.
      const factor = factorOf(state);
      state.balance = entry.balanceAfterUsd;
      state.balanceCost = entry.balanceAfterUsd * factor;
    }
  }

  const result = {};
  for (const [platform, state] of platforms) {
    result[platform] = {
      platform,
      balance: state.balance,
      balanceCost: state.balanceCost,
      factor: factorOf(state),
      purchases: state.purchases,
      discrepancies: state.discrepancies,
      wentNegative: state.wentNegative,
    };
  }
  return result;
}

/** Cost basis per purchase id, ready to replace `resolveAcquisitionFees`. */
export function costBasisByPurchaseId(replayResult = {}) {
  const out = {};
  for (const state of Object.values(replayResult)) {
    for (const purchase of state.purchases || []) {
      if (purchase.id !== undefined && purchase.id !== null) {
        out[String(purchase.id)] = { costUsd: purchase.costUsd, factor: purchase.factor };
      }
    }
  }
  return out;
}
