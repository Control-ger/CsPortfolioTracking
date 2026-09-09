/**
 * Realised profit and loss.
 *
 * Mirrors `FeeCalculationService` on the backend. The formula lived inline in
 * `FeeSettingsSection` as a preview and would have had to be written a third
 * time for the sold view; three copies of one rule is how they drift.
 */

/**
 * A percentage field as a factor.
 *
 * Accepts a comma decimal because the settings form passes its raw input
 * straight in — a German "2,5" must not silently read as 0 %.
 */
function percent(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) / 100 : 0;
}

/**
 * Proceeds after the seller fee and then the withdrawal fee on what is left.
 *
 * Order matters and matches the backend: the marketplace takes its cut of the
 * sale, and the withdrawal fee applies to the balance that actually leaves.
 * Acquisition-side fees (FX, deposit) are deliberately not part of this — they
 * belong to the cost basis, not to the proceeds.
 */
export function calculateNetProceeds(grossUsd, feeSettings = {}) {
  const gross = Number(grossUsd);
  if (!Number.isFinite(gross) || gross <= 0) {
    return 0;
  }
  const afterSeller = gross * (1 - percent(feeSettings.sellerFeePercent));
  return afterSeller * (1 - percent(feeSettings.withdrawalFeePercent));
}

/**
 * What one sale actually earned.
 *
 * Cost comes from the allocations, never from the purchase rows as they stand
 * today: `sale_allocations.buy_price_usd` is captured when the sale is recorded,
 * so re-pricing a lot later cannot restate a gain that was already realised.
 *
 * A sale that could not be fully allocated reports `unallocatedQuantity`. Its
 * ROI is deliberately computed against the cost it *does* have — the alternative
 * is dividing by an understated basis and reporting a wildly inflated return.
 */
export function calculateRealisedPnl(sale, allocations = [], feeSettings = {}) {
  const quantity = Math.max(0, Number(sale?.quantity || 0));
  const unitPrice = Number(sale?.sellPriceUsd || 0);
  const grossUsd = Number.isFinite(unitPrice) ? unitPrice * quantity : 0;
  const netUsd = calculateNetProceeds(grossUsd, feeSettings);

  const rows = Array.isArray(allocations) ? allocations : [];
  const allocatedQuantity = rows.reduce((sum, row) => sum + Number(row?.quantity || 0), 0);
  const costUsd = rows.reduce(
    (sum, row) => sum + Number(row?.buyPriceUsd || 0) * Number(row?.quantity || 0),
    0,
  );

  // Only the allocated part has a cost, so only that part can be compared. The
  // rest is proceeds without a basis and is reported, not folded in.
  const coveredFraction = quantity > 0 ? Math.min(1, allocatedQuantity / quantity) : 0;
  const grossCovered = grossUsd * coveredFraction;
  const netCovered = netUsd * coveredFraction;

  return {
    quantity,
    allocatedQuantity,
    unallocatedQuantity: Math.max(0, quantity - allocatedQuantity),
    grossUsd,
    netUsd,
    costUsd,
    grossProfitUsd: grossCovered - costUsd,
    netProfitUsd: netCovered - costUsd,
    roiPercent: costUsd > 0 ? ((netCovered - costUsd) / costUsd) * 100 : null,
  };
}

/** Portfolio-wide realised totals across a list of already-computed sales. */
export function summariseRealisedPnl(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const totals = rows.reduce(
    (acc, entry) => ({
      sales: acc.sales + 1,
      quantity: acc.quantity + Number(entry?.quantity || 0),
      grossUsd: acc.grossUsd + Number(entry?.grossUsd || 0),
      netUsd: acc.netUsd + Number(entry?.netUsd || 0),
      costUsd: acc.costUsd + Number(entry?.costUsd || 0),
      netProfitUsd: acc.netProfitUsd + Number(entry?.netProfitUsd || 0),
      unallocatedQuantity: acc.unallocatedQuantity + Number(entry?.unallocatedQuantity || 0),
    }),
    { sales: 0, quantity: 0, grossUsd: 0, netUsd: 0, costUsd: 0, netProfitUsd: 0, unallocatedQuantity: 0 },
  );

  return {
    ...totals,
    roiPercent: totals.costUsd > 0 ? (totals.netProfitUsd / totals.costUsd) * 100 : null,
  };
}
