import {
  request,
  requestWithMeta,
  resolveCurrentUserQuery,
  buildPath,
  getDesktopLocalStore,
} from "./core.js";
import { getCurrentUser } from "../auth.js";
import { resolveDesktopLocalUserId } from "../userIdentity.js";
import { unwrapLocalStoreResult } from "../localStoreResult.js";
import { runDesktopSyncNowIfDue } from "../desktopSync.js";

export async function fetchPortfolioInvestments(options = {}) {
  const userQuery = await resolveCurrentUserQuery(options);
  return requestWithMeta(buildPath("/api/v1/portfolio/investments", {
    ...userQuery,
    scope: options.scope,
  }), {
    signal: options.signal,
  });
}

export async function fetchPortfolioInvestmentHistory(id, options = {}) {
  const userQuery = await resolveCurrentUserQuery(options);
  return request(
    buildPath(`/api/v1/portfolio/investments/${id}/history`, {
      ...userQuery,
      itemName: options.itemName,
    }),
  );
}

export async function fetchItemPriceHistory(itemId, options = {}) {
  const userQuery = await resolveCurrentUserQuery(options);
  return request(buildPath(`/api/v1/items/${itemId}/price-history`, {
    ...userQuery,
    fromDate: options.fromDate,
    itemName: options.itemName,
  }), {
    signal: options.signal,
  });
}

export async function fetchPortfolioSummary(options = {}) {
  const userQuery = await resolveCurrentUserQuery(options);
  return requestWithMeta(buildPath("/api/v1/portfolio/summary", {
    ...userQuery,
    scope: options.scope,
  }), {
    signal: options.signal,
  });
}

export async function fetchPortfolioHistory(options = {}) {
  const userQuery = await resolveCurrentUserQuery(options);
  return request(buildPath("/api/v1/portfolio/history", {
    ...userQuery,
    scope: options.scope,
  }), {
    signal: options.signal,
  });
}

export async function fetchPortfolioComposition(options = {}) {
  const userQuery = await resolveCurrentUserQuery(options);
  return request(buildPath("/api/v1/portfolio/composition", {
    ...userQuery,
    scope: options.scope,
  }));
}

export async function refreshPortfolioStalePrices(options = {}) {
  const scope = String(options.scope || "investments").toLowerCase() === "all"
    ? "all"
    : "investments";
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.trunc(rawLimit), 2000))
    : 200;

  const userQuery = await resolveCurrentUserQuery(options);

  return requestWithMeta("/api/v1/portfolio/prices/refresh-stale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...userQuery, scope, limit }),
    signal: options.signal,
  });
}

export async function savePortfolioDailyValue(totalValue) {
  const userQuery = await resolveCurrentUserQuery();
  return request("/api/v1/portfolio/daily-value", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...userQuery, totalValue }),
  });
}

export async function toggleExcludeInvestment(id, exclude, sourceInvestmentIds = []) {
  const localStore = getDesktopLocalStore();
  if (localStore) {
    const candidateIdsRaw = Array.isArray(sourceInvestmentIds) && sourceInvestmentIds.length > 0
      ? sourceInvestmentIds
      : [id];
    const candidateIds = Array.from(
      new Set(candidateIdsRaw.map((candidateId) => String(candidateId || "").trim()).filter(Boolean)),
    );
    let updatedCount = 0;

    for (const candidateId of candidateIds) {
      const existing = unwrapLocalStoreResult(
        await localStore.getInvestment(candidateId),
        "local-store-get-investment",
      );

      if (!existing) {
        continue;
      }

      unwrapLocalStoreResult(
        await localStore.upsertInvestment({
          ...existing,
          excluded: Boolean(exclude),
          isExcluded: Boolean(exclude),
        }),
        "local-store-upsert-investment",
      );
      updatedCount += 1;
    }

    if (updatedCount === 0) {
      throw new Error(
        `Exclude toggle skipped: no local investment found for id=${String(id)}`,
      );
    }

    let syncResult;
    try {
      syncResult = await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] exclude sync failed", syncError);
      throw new Error(
        `Exclude was updated locally, but sync to server failed: ${syncError?.message || String(syncError)}`,
      );
    }

    if (syncResult?.skipped) {
      throw new Error(
        `Exclude was updated locally, but sync was skipped (${String(syncResult.reason || "unknown")}).`,
      );
    }

    return {
      data: {
        success: true,
        investmentId: id,
        excluded: Boolean(exclude),
      },
      meta: {
        source: "desktop-local",
      },
    };
  }

  const userQuery = await resolveCurrentUserQuery();
  return requestWithMeta(`/api/v1/portfolio/investments/${id}/exclude`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...userQuery, exclude }),
  });
}

export async function updateInvestmentBucket(id, bucket, sourceInvestmentIds = []) {
  const normalizedBucket = String(bucket || "").trim().toLowerCase() === "inventory"
    ? "inventory"
    : "investment";
  const localStore = getDesktopLocalStore();
  if (localStore) {
    const requestedId = String(id || "").trim();
    const attemptedIds = new Set();
    const candidateIds = (Array.isArray(sourceInvestmentIds) && sourceInvestmentIds.length > 0
      ? sourceInvestmentIds
      : [id]).map((candidateId) => String(candidateId || "").trim()).filter(Boolean);
    let updatedCount = 0;

    for (const candidateId of candidateIds) {
      if (attemptedIds.has(candidateId)) {
        continue;
      }
      attemptedIds.add(candidateId);
      const existing = unwrapLocalStoreResult(
        await localStore.getInvestment(candidateId),
        "local-store-get-investment",
      );

      if (!existing) {
        continue;
      }

      unwrapLocalStoreResult(
        await localStore.upsertInvestment({
          ...existing,
          bucket: normalizedBucket,
        }),
        "local-store-upsert-investment",
      );
      updatedCount += 1;
    }

    if (updatedCount === 0) {
      try {
        const currentUser = await getCurrentUser();
        const userId = resolveDesktopLocalUserId(currentUser);
        const localRows = unwrapLocalStoreResult(
          await localStore.listInvestments(userId),
          "local-store-list-investments",
        );
        const investments = Array.isArray(localRows) ? localRows : [];
        const fallbackIds = [];

        if (requestedId.startsWith("cluster-")) {
          const clusterKey = requestedId.slice("cluster-".length).trim().toLowerCase();
          if (clusterKey) {
            investments.forEach((row) => {
              const rowKey = String(row?.marketHashName || row?.name || row?.itemName || row?.id || "")
                .trim()
                .toLowerCase();
              if (rowKey === clusterKey) {
                fallbackIds.push(String(row?.id || "").trim());
              }
            });
          }
        }

        for (const fallbackId of fallbackIds) {
          if (!fallbackId || attemptedIds.has(fallbackId)) {
            continue;
          }
          attemptedIds.add(fallbackId);
          const existing = unwrapLocalStoreResult(
            await localStore.getInvestment(fallbackId),
            "local-store-get-investment",
          );
          if (!existing) {
            continue;
          }
          unwrapLocalStoreResult(
            await localStore.upsertInvestment({
              ...existing,
              bucket: normalizedBucket,
            }),
            "local-store-upsert-investment",
          );
          updatedCount += 1;
        }
      } catch (fallbackError) {
        console.warn("[desktop-sync] bucket fallback resolution failed", fallbackError);
      }
    }

    if (updatedCount === 0) {
      throw new Error(
        `Bucket update skipped: no local investment found for id=${String(id)}`,
      );
    }

    try {
      await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] bucket update sync failed", syncError);
    }

    return {
      data: {
        success: true,
        investmentId: id,
        bucket: normalizedBucket,
      },
      meta: {
        source: "desktop-local",
      },
    };
  }

  const userQuery = await resolveCurrentUserQuery();
  return requestWithMeta(`/api/v1/portfolio/investments/${id}/bucket`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...userQuery, bucket: normalizedBucket }),
  });
}

export async function updateInvestmentOverpay(
  id,
  payload = {},
  sourceInvestmentIds = [],
) {
  const normalizedOverpayEnabled = Boolean(
    payload?.overpayEnabled ?? payload?.isOverpayCandidate ?? false,
  );
  const parsedFloor = Number(payload?.overpayFloorEur);
  const normalizedFloor =
    Number.isFinite(parsedFloor) && parsedFloor > 0
      ? Number(parsedFloor.toFixed(2))
      : null;
  const normalizedNote = String(payload?.overpayNote || "").trim();
  const localStore = getDesktopLocalStore();

  if (localStore) {
    const candidateIdsRaw = Array.isArray(sourceInvestmentIds) && sourceInvestmentIds.length > 0
      ? sourceInvestmentIds
      : [id];
    const candidateIds = Array.from(
      new Set(candidateIdsRaw.map((candidateId) => String(candidateId || "").trim()).filter(Boolean)),
    );
    let updatedCount = 0;

    for (const candidateId of candidateIds) {
      const existing = unwrapLocalStoreResult(
        await localStore.getInvestment(candidateId),
        "local-store-get-investment",
      );

      if (!existing) {
        continue;
      }

      unwrapLocalStoreResult(
        await localStore.upsertInvestment({
          ...existing,
          overpayEnabled: normalizedOverpayEnabled,
          isOverpayCandidate: normalizedOverpayEnabled,
          overpayFloorEur: normalizedFloor,
          overpayNote: normalizedNote || null,
        }),
        "local-store-upsert-investment",
      );
      updatedCount += 1;
    }

    if (updatedCount === 0) {
      throw new Error(
        `Overpay update skipped: no local investment found for id=${String(id)}`,
      );
    }

    let syncResult;
    try {
      syncResult = await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] overpay sync failed", syncError);
      throw new Error(
        `Overpay profile updated locally, but sync to server failed: ${syncError?.message || String(syncError)}`,
      );
    }

    if (syncResult?.skipped) {
      throw new Error(
        `Overpay profile updated locally, but sync was skipped (${String(syncResult.reason || "unknown")}).`,
      );
    }

    return {
      data: {
        success: true,
        investmentId: id,
        overpayEnabled: normalizedOverpayEnabled,
        overpayFloorEur: normalizedFloor,
        overpayNote: normalizedNote || null,
      },
      meta: {
        source: "desktop-local",
      },
    };
  }

  const userQuery = await resolveCurrentUserQuery();
  return requestWithMeta(`/api/v1/portfolio/investments/${id}/overpay`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...userQuery,
      overpayEnabled: normalizedOverpayEnabled,
      overpayFloorEur: normalizedFloor,
      overpayNote: normalizedNote || null,
    }),
  });
}
