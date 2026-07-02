import {
  requestWithMeta,
  getDesktopLocalStore,
  applyDesktopCsFloatPreviewDeduplication,
  applyDesktopSkinBaronPreviewDeduplication,
  buildExistingInvestmentLookup,
  mapCsFloatPreviewTradeToInvestment,
  mapSkinBaronPreviewSaleToInvestment,
  resolveExistingCsFloatInvestmentMatch,
  resolveExistingSkinBaronInvestmentMatch,
  normalizeImportIdentifier,
} from "./core.js";
import { getCurrentUser } from "../auth.js";
import { resolveDesktopLocalUserId } from "../userIdentity.js";
import { unwrapLocalStoreResult } from "../localStoreResult.js";
import { getPortfolioPreferences } from "../portfolioPreferences.js";
import { runDesktopSyncNowIfDue } from "../desktopSync.js";

export async function fetchCsFloatTradeSyncPreview(payload = {}) {
  const previewResponse = await requestWithMeta("/api/v1/portfolio/sync/csfloat/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: payload.type || "buy",
      limit: payload.limit || 1000,
      maxPages: payload.maxPages || 10,
    }),
  });
  return applyDesktopCsFloatPreviewDeduplication(previewResponse);
}

export async function executeCsFloatTradeSync(payload = {}) {
  const localStore = getDesktopLocalStore();
  if (localStore) {
    const preview = await fetchCsFloatTradeSyncPreview(payload);
    const preferences = await getPortfolioPreferences();
    const targetBucket = preferences.csfloatImportBucket === "inventory" ? "inventory" : "investment";
    const currentUser = await getCurrentUser();
    const userId = resolveDesktopLocalUserId(currentUser);
    const trades = Array.isArray(preview?.data?.importTrades)
      ? preview.data.importTrades
      : Array.isArray(preview?.data?.sampleTrades)
        ? preview.data.sampleTrades
      : [];
    const investments = unwrapLocalStoreResult(
      await localStore.listInvestments(userId),
      "local-store-list-investments",
    );
    const existingLookup = buildExistingInvestmentLookup(investments, "csfloat");
    let inserted = 0;
    let duplicates = 0;

    for (const trade of trades) {
      if (String(trade?.status || "").toLowerCase() === "excluded") {
        continue;
      }

      const row = mapCsFloatPreviewTradeToInvestment(trade);
      const existing = resolveExistingCsFloatInvestmentMatch(existingLookup, row, trade);
      const rowForUpsert = existing
        ? {
            ...row,
            // Keep stable identifiers for already-known entries: a re-import whose
            // cluster key changed (e.g. legacy key scheme) must update the existing
            // row instead of inserting a sibling under a new id. A new id would
            // orphan portfolio-group memberInvestmentIds and duplicate the position.
            id: String(existing?.id || row.id),
            externalTradeId:
              String(existing?.externalTradeId || "").trim() || row.externalTradeId,
            // Never reset a user-chosen bucket (e.g. "inventory") back to the
            // import default on re-import.
            bucket: existing.bucket || targetBucket,
          }
        : {
            ...row,
            bucket: targetBucket,
          };

      unwrapLocalStoreResult(
        await localStore.upsertInvestment({
          ...(existing || {}),
          ...rowForUpsert,
          userId,
          excluded: Boolean(existing?.excluded),
        }),
        "local-store-upsert-investment",
      );

      if (existing) {
        duplicates += 1;
      } else {
        inserted += 1;
      }

      const rowId = String(rowForUpsert?.id || "").trim();
      if (rowId) {
        existingLookup.byId.set(rowId, rowForUpsert);
      }
      const externalTradeId = normalizeImportIdentifier(rowForUpsert?.externalTradeId);
      if (externalTradeId) {
        existingLookup.byExternalTradeId.set(externalTradeId, rowForUpsert);
      }
    }

    await triggerDesktopSteamMatchingRefresh(localStore, userId);

    try {
      await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] csfloat execute sync failed", syncError);
    }

    return {
      data: {
        ...(preview?.data || {}),
        mode: "execute",
        status: "success",
        inserted,
        duplicates,
        skippedDuringInsert: 0,
        errors: [],
        desktopLocal: true,
      },
      meta: {
        source: "desktop-local",
      },
    };
  }

  return requestWithMeta("/api/v1/portfolio/sync/csfloat/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: payload.type || "buy",
      limit: payload.limit || 1000,
      maxPages: payload.maxPages || 10,
      backupConfirmed: Boolean(payload.backupConfirmed),
    }),
  });
}

async function triggerDesktopSteamMatchingRefresh(localStore, userId) {
  try {
    const rows = unwrapLocalStoreResult(
      await localStore.listInvestments(userId),
      "local-store-list-investments",
    );
    const activeSteamRows = (Array.isArray(rows) ? rows : []).filter((row) => {
      const platform = String(row?.platform || row?.source || "").toLowerCase();
      if (platform !== "steam_inventory") {
        return false;
      }
      if (row?.inSteamInventory === false) {
        return false;
      }
      return String(row?.inventoryStatus || "").toLowerCase() !== "missing";
    });

    if (activeSteamRows.length === 0) {
      return;
    }

    const snapshotItems = activeSteamRows.map((row) => ({
      id: row?.steamAssetId || row?.id,
      assetId: row?.steamAssetId || row?.id,
      marketHashName: row?.marketHashName || row?.name || "Unknown Item",
      name: row?.name || row?.marketHashName || "Unknown Item",
      type: row?.type || "skin",
      imageUrl: row?.imageUrl || null,
      classId: row?.classId || null,
      instanceId: row?.instanceId || null,
      inspectLink: row?.inspectLink || null,
      floatValue: row?.floatValue ?? row?.float ?? row?.wearFloat ?? null,
      paintSeed: row?.paintSeed ?? row?.patternSeed ?? null,
      tradable: row?.tradable !== false,
      marketable: row?.marketable !== false,
    }));

    unwrapLocalStoreResult(
      await localStore.syncSteamInventory(snapshotItems, userId),
      "local-store-sync-steam-inventory",
    );
  } catch (error) {
    console.warn("[desktop-sync] external matching refresh failed", error);
  }
}

export async function fetchSkinBaronTradeSyncPreview(payload = {}) {
  const previewResponse = await requestWithMeta("/api/v1/portfolio/sync/skinbaron/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: payload.limit || 100,
      maxPages: payload.maxPages || 10,
    }),
  });
  return applyDesktopSkinBaronPreviewDeduplication(previewResponse);
}

export async function executeSkinBaronTradeSync(payload = {}) {
  const localStore = getDesktopLocalStore();
  if (localStore) {
    const preview = await fetchSkinBaronTradeSyncPreview(payload);
    const preferences = await getPortfolioPreferences();
    const preferredBucket = preferences?.skinBaronImportBucket ?? preferences?.csfloatImportBucket;
    const targetBucket = preferredBucket === "inventory" ? "inventory" : "investment";
    const currentUser = await getCurrentUser();
    const userId = resolveDesktopLocalUserId(currentUser);
    const trades = Array.isArray(preview?.data?.importTrades)
      ? preview.data.importTrades
      : Array.isArray(preview?.data?.sampleTrades)
        ? preview.data.sampleTrades
        : [];
    const investments = unwrapLocalStoreResult(
      await localStore.listInvestments(userId),
      "local-store-list-investments",
    );
    const existingLookup = buildExistingInvestmentLookup(investments, "skinbaron");
    let inserted = 0;
    let duplicates = 0;

    for (const trade of trades) {
      if (String(trade?.status || "").toLowerCase() === "excluded") {
        continue;
      }

      const row = {
        ...mapSkinBaronPreviewSaleToInvestment(trade),
        bucket: targetBucket,
      };
      const existing = resolveExistingSkinBaronInvestmentMatch(existingLookup, row, trade);
      const rowForUpsert = existing
        ? {
            ...row,
            // Keep stable identifiers for already-known entries so re-imports
            // with changed language-derived hashes do not create duplicates.
            id: String(existing?.id || row.id),
            externalTradeId: String(existing?.externalTradeId || row.externalTradeId || "").trim()
              || row.externalTradeId,
            skinBaronTransferId:
              existing?.skinBaronTransferId
                || existing?.skinBaronSaleId
                || row.skinBaronTransferId
                || row.skinBaronSaleId
                || null,
            skinBaronSaleId:
              existing?.skinBaronTransferId
                || existing?.skinBaronSaleId
                || row.skinBaronTransferId
                || row.skinBaronSaleId
                || null,
            skinBaronOfferLink:
              existing?.skinBaronOfferLink
                || existing?.offerLink
                || row.skinBaronOfferLink
                || null,
          }
        : row;

      unwrapLocalStoreResult(
        await localStore.upsertInvestment({
          ...(existing || {}),
          ...rowForUpsert,
          userId,
          excluded: Boolean(existing?.excluded),
        }),
        "local-store-upsert-investment",
      );

      if (existing) {
        duplicates += 1;
      } else {
        inserted += 1;
      }

      const rowId = String(rowForUpsert?.id || "").trim();
      if (rowId) {
        existingLookup.byId.set(rowId, rowForUpsert);
      }
      const externalTradeId = normalizeImportIdentifier(rowForUpsert?.externalTradeId);
      if (externalTradeId) {
        existingLookup.byExternalTradeId.set(externalTradeId, rowForUpsert);
      }
      const normalizedTransfer = normalizeImportIdentifier(
        rowForUpsert?.skinBaronTransferId || rowForUpsert?.skinBaronSaleId,
      );
      const normalizedOffer = normalizeImportIdentifier(
        rowForUpsert?.skinBaronOfferLink || rowForUpsert?.offerLink,
      );
      if (normalizedTransfer && normalizedOffer) {
        existingLookup.bySkinBaronTransferOffer.set(
          `${normalizedTransfer}::${normalizedOffer}`,
          rowForUpsert,
        );
      }
    }

    await triggerDesktopSteamMatchingRefresh(localStore, userId);

    try {
      await runDesktopSyncNowIfDue({ force: true });
    } catch (syncError) {
      console.warn("[desktop-sync] skinbaron execute sync failed", syncError);
    }

    return {
      data: {
        ...(preview?.data || {}),
        mode: "execute",
        status: "success",
        inserted,
        duplicates,
        skippedDuringInsert: 0,
        errors: [],
        desktopLocal: true,
      },
      meta: {
        source: "desktop-local",
      },
    };
  }

  return requestWithMeta("/api/v1/portfolio/sync/skinbaron/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: payload.limit || 100,
      maxPages: payload.maxPages || 10,
      backupConfirmed: Boolean(payload.backupConfirmed),
    }),
  });
}
