import { randomUUID } from "crypto";
import {
  nowIso,
  serialize,
  deserialize,
  normalizeLocalUserId,
  normalizeBucket,
  toFiniteNumber,
  valuesEqual,
  calculateSteamCsfloatMatch,
  CANONICAL_LOCAL_USER_ID,
  DESKTOP_STEAM_USER_ID_PATTERN,
  DEFAULT_PORTFOLIO_PREFERENCES,
} from "./utils.js";
import { mapInvestment } from "./investments.js";

function legacyRowsExist(db) {
  const investmentCount = db
    .prepare("SELECT COUNT(*) AS count FROM investments WHERE user_id = ?")
    .get(CANONICAL_LOCAL_USER_ID).count;
  const watchlistCount = db
    .prepare("SELECT COUNT(*) AS count FROM watchlist_items WHERE user_id = ?")
    .get(CANONICAL_LOCAL_USER_ID).count;
  const inventoryStateCount = db
    .prepare("SELECT COUNT(*) AS count FROM steam_inventory_state WHERE user_id = ?")
    .get(CANONICAL_LOCAL_USER_ID).count;

  return Number(investmentCount || 0) + Number(watchlistCount || 0) + Number(inventoryStateCount || 0) > 0;
}

function rewritePendingOperationsUserId(db, fromUserId, toUserId) {
  const rows = db
    .prepare(
      `SELECT id, payload
       FROM operations_log
       WHERE applied_at IS NULL`,
    )
    .all();
  const update = db.prepare("UPDATE operations_log SET payload = ? WHERE id = ?");

  rows.forEach((row) => {
    const payload = deserialize(row.payload, {});
    const payloadUserId = normalizeLocalUserId(payload.userId ?? payload.user_id);
    if (payloadUserId !== fromUserId) {
      return;
    }

    const nextPayload = {
      ...payload,
      userId: toUserId,
    };
    if (Object.prototype.hasOwnProperty.call(nextPayload, "user_id")) {
      nextPayload.user_id = toUserId;
    }

    update.run(serialize(nextPayload), row.id);
  });
}

const createMigrateLegacyUserRowsToSteamUser = (db) => {
  return db.transaction((targetUserId) => {
    const normalizedTargetUserId = normalizeLocalUserId(targetUserId);
    if (!DESKTOP_STEAM_USER_ID_PATTERN.test(normalizedTargetUserId)) {
      return { migrated: false, reason: "target-not-steam-user" };
    }
    if (!legacyRowsExist(db)) {
      return { migrated: false, reason: "no-legacy-rows" };
    }
    const counts = {};

    [
      "investments",
      "watchlist_items",
      "steam_inventory_state",
      "sync_notifications",
    ].forEach((table) => {
      const beforeCount = db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`)
        .get(CANONICAL_LOCAL_USER_ID).count;
      db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`)
        .run(normalizedTargetUserId, CANONICAL_LOCAL_USER_ID);
      counts[table] = Number(beforeCount || 0);
    });

    const snapshotCount = db
      .prepare("SELECT COUNT(*) AS count FROM portfolio_snapshots WHERE user_id = ?")
      .get(CANONICAL_LOCAL_USER_ID).count;
    db.prepare(
      `UPDATE portfolio_snapshots
       SET user_id = ?
       WHERE user_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM portfolio_snapshots target
           WHERE target.user_id = ?
             AND target.captured_at = portfolio_snapshots.captured_at
         )`,
    ).run(normalizedTargetUserId, CANONICAL_LOCAL_USER_ID, normalizedTargetUserId);
    db.prepare("DELETE FROM portfolio_snapshots WHERE user_id = ?")
      .run(CANONICAL_LOCAL_USER_ID);
    counts.portfolio_snapshots = Number(snapshotCount || 0);

    const matchCount = db
      .prepare("SELECT COUNT(*) AS count FROM steam_csfloat_matches WHERE user_id = ?")
      .get(CANONICAL_LOCAL_USER_ID).count;
    db.prepare(
      `UPDATE steam_csfloat_matches
       SET user_id = ?
       WHERE user_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM steam_csfloat_matches target
           WHERE target.user_id = ?
             AND target.steam_asset_id = steam_csfloat_matches.steam_asset_id
             AND target.csfloat_investment_id = steam_csfloat_matches.csfloat_investment_id
         )`,
    ).run(normalizedTargetUserId, CANONICAL_LOCAL_USER_ID, normalizedTargetUserId);
    db.prepare("DELETE FROM steam_csfloat_matches WHERE user_id = ?")
      .run(CANONICAL_LOCAL_USER_ID);
    counts.steam_csfloat_matches = Number(matchCount || 0);

    const legacyPrefix = `portfolio_pref:${CANONICAL_LOCAL_USER_ID}:`;
    const targetPrefix = `portfolio_pref:${normalizedTargetUserId}:`;
    const now = nowIso();
    const upsertMeta = db.prepare(
      `INSERT INTO meta (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const deleteMeta = db.prepare("DELETE FROM meta WHERE key = ?");
    db
      .prepare(
        `SELECT key, value
         FROM meta
         WHERE key LIKE ?`,
      )
      .all(`${legacyPrefix}%`)
      .forEach((row) => {
        const preferenceKey = String(row.key || "").slice(legacyPrefix.length);
        if (!preferenceKey) {
          return;
        }
        upsertMeta.run(`${targetPrefix}${preferenceKey}`, String(row.value || ""), now);
        deleteMeta.run(row.key);
      });

    rewritePendingOperationsUserId(db, CANONICAL_LOCAL_USER_ID, normalizedTargetUserId);

    return {
      migrated: true,
      fromUserId: CANONICAL_LOCAL_USER_ID,
      toUserId: normalizedTargetUserId,
      counts,
    };
  });
};

export function createSyncStore(db, { upsertInvestment, getPortfolioPreferences }) {
  const migrateLegacyUserRowsToSteamUser = createMigrateLegacyUserRowsToSteamUser(db);

  function maybeMigrateLegacyUserRows(userId) {
    const normalizedUserId = normalizeLocalUserId(userId);
    if (!DESKTOP_STEAM_USER_ID_PATTERN.test(normalizedUserId)) {
      return { migrated: false, reason: "not-steam-user" };
    }
    return migrateLegacyUserRowsToSteamUser(normalizedUserId);
  }

  function mapSteamCsfloatMatch(row) {
    return {
      id: row.id,
      userId: row.user_id,
      steamAssetId: row.steam_asset_id,
      steamItemName: row.steam_item_name,
      csfloatInvestmentId: row.csfloat_investment_id,
      csfloatTradeId: row.csfloat_trade_id,
      matchScore: Number(row.match_score || 0),
      confidence: row.confidence,
      status: row.status,
      reason: row.reason || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function applySteamCsfloatMatchLink(userId, steamAssetId, csfloatInvestmentId) {
    const steamRow = db
      .prepare(
        `SELECT * FROM investments
         WHERE user_id = ? AND id = ? AND deleted = 0
         LIMIT 1`,
      )
      .get(normalizeLocalUserId(userId), String(steamAssetId || ""));
    const csfloatRow = db
      .prepare(
        `SELECT * FROM investments
         WHERE user_id = ? AND id = ? AND deleted = 0
         LIMIT 1`,
      )
      .get(normalizeLocalUserId(userId), String(csfloatInvestmentId || ""));

    if (!steamRow || !csfloatRow) {
      return false;
    }

    const steamInvestment = mapInvestment(steamRow);
    const csfloatInvestment = mapInvestment(csfloatRow);

    const steamPrice = toFiniteNumber(steamInvestment.buyPriceUsd ?? steamInvestment.buyPrice);
    const csfloatPrice = toFiniteNumber(csfloatInvestment.buyPriceUsd ?? csfloatInvestment.buyPrice);

    let changed = false;

    if ((steamPrice === null || steamPrice <= 0) && csfloatPrice !== null && csfloatPrice > 0) {
      upsertInvestment({
        ...steamInvestment,
        id: steamInvestment.id,
        userId: steamInvestment.userId,
        buyPriceUsd: csfloatPrice,
        buyPrice: csfloatPrice,
        priceSetMode: "matched_csfloat",
        matchedCsfloatInvestmentId: String(csfloatInvestmentId),
      });
      changed = true;
    }

    const csfloatExcluded = Boolean(csfloatInvestment.excluded || csfloatInvestment.isExcluded);
    if (!csfloatExcluded) {
      upsertInvestment({
        ...csfloatInvestment,
        id: csfloatInvestment.id,
        userId: csfloatInvestment.userId,
        excluded: true,
        isExcluded: true,
        matchedSteamAssetId: String(steamAssetId),
        duplicateResolvedBy: "steam_csfloat_match",
      });
      changed = true;
    }

    return changed;
  }

  function applyResolvedSteamCsfloatMatches(userId = CANONICAL_LOCAL_USER_ID) {
    const normalizedUserId = normalizeLocalUserId(userId);
    const rows = db
      .prepare(
        `SELECT steam_asset_id, csfloat_investment_id
         FROM steam_csfloat_matches
         WHERE user_id = ? AND status IN ('manual_confirmed', 'auto_linked')`,
      )
      .all(normalizedUserId);

    let changedCount = 0;
    rows.forEach((row) => {
      const didChange = applySteamCsfloatMatchLink(
        normalizedUserId,
        String(row.steam_asset_id || ""),
        String(row.csfloat_investment_id || ""),
      );
      if (didChange) {
        changedCount += 1;
      }
    });

    return changedCount;
  }

  return {
    maybeMigrateLegacyUserRows,

    syncSteamInventory(items = [], userId = CANONICAL_LOCAL_USER_ID) {
      const normalizedUserId = normalizeLocalUserId(userId);
      maybeMigrateLegacyUserRows(normalizedUserId);
      const now = nowIso();
      const preferences = getPortfolioPreferences(normalizedUserId);
      const steamDefaultBucket = normalizeBucket(
        preferences.steamImportBucket,
        DEFAULT_PORTFOLIO_PREFERENCES.steamImportBucket,
      );
      const incoming = (Array.isArray(items) ? items : [])
        .map((item) => {
          const steamAssetId = String(item.assetId || item.id || "").trim();
          if (!steamAssetId) {
            return null;
          }
          return {
            id: steamAssetId,
            steamAssetId,
            name: String(item.marketHashName || item.name || "Unknown Item"),
            marketHashName: String(item.marketHashName || item.name || "Unknown Item"),
            type: String(item.type || "skin"),
            quantity: 1,
            imageUrl: item.iconUrl
              ? `https://community.cloudflare.steamstatic.com/economy/image/${item.iconUrl}`
              : item.imageUrl || null,
            classId: item.classId ? String(item.classId) : null,
            instanceId: item.instanceId ? String(item.instanceId) : null,
            inspectLink: item.inspectLink || null,
            floatValue: toFiniteNumber(item.floatValue ?? item.float ?? item.wearFloat),
            paintSeed: toFiniteNumber(item.paintSeed ?? item.patternSeed),
            tradable: Boolean(item.tradable),
            marketable: Boolean(item.marketable),
          };
        })
        .filter(Boolean);

      const incomingIds = new Set(incoming.map((item) => item.id));

      // We need listInvestments, but we don't have it in this module's deps.
      // We'll query directly from db for the steam inventory query.
      const allInvestmentsRows = db
        .prepare(
          `SELECT * FROM investments
           WHERE user_id = ? AND deleted = 0
           ORDER BY updated_at DESC`,
        )
        .all(normalizedUserId);
      const allInvestments = allInvestmentsRows.map(mapInvestment);

      const steamInvestments = allInvestments.filter((investment) => {
        const platform = String(investment.platform || investment.source || "").toLowerCase();
        return platform === "steam_inventory" || Boolean(investment.steamAssetId);
      });
      const steamById = new Map(steamInvestments.map((investment) => [String(investment.id), investment]));

      let imported = 0;
      let updated = 0;
      let missingMarked = 0;
      const importedItems = [];

      for (const item of incoming) {
        const existing = steamById.get(item.id);
        const upsertPayload = {
          ...(existing || {}),
          id: item.id,
          userId: normalizedUserId,
          name: item.name,
          marketHashName: item.marketHashName,
          type: item.type,
          quantity: 1,
          buyPriceUsd: existing?.buyPriceUsd ?? 0,
          fundingMode: existing?.fundingMode || "wallet_funded",
          imageUrl: item.imageUrl || existing?.imageUrl || null,
          platform: "steam_inventory",
          source: "steam_inventory",
          steamAssetId: item.steamAssetId,
          classId: item.classId,
          instanceId: item.instanceId,
          inspectLink: item.inspectLink,
          floatValue: item.floatValue ?? existing?.floatValue ?? null,
          paintSeed: item.paintSeed ?? existing?.paintSeed ?? null,
          tradable: item.tradable,
          marketable: item.marketable,
          inSteamInventory: true,
          inventoryStatus: "active",
          firstSeenAt: existing?.firstSeenAt || now,
          lastSeenAt: now,
          lastMissingAt: null,
          bucket: normalizeBucket(existing?.bucket, steamDefaultBucket),
          excluded: Boolean(existing?.excluded),
        };

        const shouldUpsert =
          !existing ||
          !valuesEqual(existing.name, upsertPayload.name) ||
          !valuesEqual(existing.marketHashName, upsertPayload.marketHashName) ||
          !valuesEqual(existing.type, upsertPayload.type) ||
          !valuesEqual(existing.imageUrl, upsertPayload.imageUrl) ||
          !valuesEqual(existing.classId, upsertPayload.classId) ||
          !valuesEqual(existing.instanceId, upsertPayload.instanceId) ||
          !valuesEqual(existing.inspectLink, upsertPayload.inspectLink) ||
          !valuesEqual(existing.floatValue, upsertPayload.floatValue) ||
          !valuesEqual(existing.paintSeed, upsertPayload.paintSeed) ||
          !valuesEqual(existing.tradable, upsertPayload.tradable) ||
          !valuesEqual(existing.marketable, upsertPayload.marketable) ||
          existing.inSteamInventory !== true ||
          String(existing.inventoryStatus || "") !== "active" ||
          Boolean(existing.lastMissingAt);

        if (shouldUpsert) {
          upsertInvestment(upsertPayload);
        }

        if (existing) {
          if (shouldUpsert) {
            updated += 1;
          }
        } else {
          imported += 1;
          if (importedItems.length < 50) {
            importedItems.push({
              id: item.id,
              name: item.name,
              type: item.type,
              imageUrl: item.imageUrl || null,
              steamAssetId: item.steamAssetId,
            });
          }
        }

        db.prepare(
          `INSERT INTO steam_inventory_state (
            steam_asset_id, user_id, market_hash_name, item_type, in_inventory,
            first_seen_at, last_seen_at, last_missing_at, payload
          ) VALUES (
            @steamAssetId, @userId, @marketHashName, @itemType, 1,
            @firstSeenAt, @lastSeenAt, NULL, @payload
          )
          ON CONFLICT(steam_asset_id) DO UPDATE SET
            user_id = excluded.user_id,
            market_hash_name = excluded.market_hash_name,
            item_type = excluded.item_type,
            in_inventory = 1,
            last_seen_at = excluded.last_seen_at,
            last_missing_at = NULL,
            payload = excluded.payload`,
        ).run({
          steamAssetId: item.steamAssetId,
          userId: normalizedUserId,
          marketHashName: item.marketHashName,
          itemType: item.type,
          firstSeenAt: existing?.firstSeenAt || now,
          lastSeenAt: now,
          payload: serialize(item),
        });
      }

      for (const investment of steamInvestments) {
        if (incomingIds.has(String(investment.id))) {
          continue;
        }
        const alreadyMissing =
          investment.inSteamInventory === false &&
          String(investment.inventoryStatus || "") === "missing";

        if (!alreadyMissing) {
          upsertInvestment({
            ...investment,
            id: investment.id,
            userId: normalizedUserId,
            platform: "steam_inventory",
            source: "steam_inventory",
            inSteamInventory: false,
            inventoryStatus: "missing",
            lastMissingAt: now,
            lastSeenAt: investment.lastSeenAt || investment.updatedAt || now,
            bucket: normalizeBucket(investment?.bucket, steamDefaultBucket),
          });
          missingMarked += 1;
        }

        db.prepare(
          `INSERT INTO steam_inventory_state (
            steam_asset_id, user_id, market_hash_name, item_type, in_inventory,
            first_seen_at, last_seen_at, last_missing_at, payload
          ) VALUES (
            @steamAssetId, @userId, @marketHashName, @itemType, 0,
            @firstSeenAt, @lastSeenAt, @lastMissingAt, @payload
          )
          ON CONFLICT(steam_asset_id) DO UPDATE SET
            in_inventory = 0,
            last_missing_at = excluded.last_missing_at,
            payload = excluded.payload`,
        ).run({
          steamAssetId: String(investment.id),
          userId: normalizedUserId,
          marketHashName: String(investment.marketHashName || investment.name || ""),
          itemType: String(investment.type || "skin"),
          firstSeenAt: investment.firstSeenAt || investment.createdAt || now,
          lastSeenAt: investment.lastSeenAt || investment.updatedAt || now,
          lastMissingAt: now,
          payload: serialize(investment),
        });
      }

      const csfloatCandidates = allInvestments.filter((investment) => {
        const platform = String(investment.platform || investment.source || "").toLowerCase();
        return (
          platform === "csfloat" ||
          String(investment.id || "").startsWith("csfloat-")
        );
      });

      const confidenceRank = { high: 3, medium: 2, low: 1 };
      const blockedSteamAssetIds = new Set(
        db
          .prepare(
            `SELECT steam_asset_id
             FROM steam_csfloat_matches
             WHERE user_id = ? AND status IN ('manual_confirmed', 'auto_linked')`,
          )
          .all(normalizedUserId)
          .map((row) => String(row.steam_asset_id || "")),
      );

      const candidateEdges = [];
      for (const steamItem of incoming) {
        if (blockedSteamAssetIds.has(String(steamItem.steamAssetId || ""))) {
          continue;
        }
        for (const csfloatItem of csfloatCandidates) {
          const calculated = calculateSteamCsfloatMatch(steamItem, csfloatItem);
          if (!calculated || calculated.score < 48) {
            continue;
          }
          candidateEdges.push({
            steamItem,
            csfloatItem,
            score: calculated.score,
            confidence: calculated.confidence,
            reasons: calculated.reasons,
          });
        }
      }

      candidateEdges.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        const confidenceDelta =
          (confidenceRank[b.confidence] || 0) - (confidenceRank[a.confidence] || 0);
        if (confidenceDelta !== 0) {
          return confidenceDelta;
        }
        return String(a.steamItem.steamAssetId || "").localeCompare(String(b.steamItem.steamAssetId || ""));
      });

      const assignedSteam = new Set();
      const assignedCsfloat = new Set();
      let matchesSuggested = 0;
      for (const edge of candidateEdges) {
        const steamAssetId = String(edge.steamItem.steamAssetId || "");
        const csfloatInvestmentId = String(edge.csfloatItem.id || "");
        if (!steamAssetId || !csfloatInvestmentId) {
          continue;
        }
        if (assignedSteam.has(steamAssetId) || assignedCsfloat.has(csfloatInvestmentId)) {
          continue;
        }

        const existingMatch = db
          .prepare(
            `SELECT id, status FROM steam_csfloat_matches
             WHERE user_id = ? AND steam_asset_id = ? AND csfloat_investment_id = ?
             LIMIT 1`,
          )
          .get(normalizedUserId, steamAssetId, csfloatInvestmentId);

        if (existingMatch?.status === "manual_confirmed" || existingMatch?.status === "rejected") {
          continue;
        }

        assignedSteam.add(steamAssetId);
        assignedCsfloat.add(csfloatInvestmentId);

        const status = edge.confidence === "high" ? "auto_linked" : "suggested";
        const reason = edge.reasons.join(",");
        db.prepare(
          `INSERT INTO steam_csfloat_matches (
            id, user_id, steam_asset_id, steam_item_name, csfloat_investment_id, csfloat_trade_id,
            match_score, confidence, status, reason, created_at, updated_at
          ) VALUES (
            @id, @userId, @steamAssetId, @steamItemName, @csfloatInvestmentId, @csfloatTradeId,
            @matchScore, @confidence, @status, @reason, @createdAt, @updatedAt
          )
          ON CONFLICT(user_id, steam_asset_id, csfloat_investment_id) DO UPDATE SET
            steam_item_name = excluded.steam_item_name,
            csfloat_trade_id = excluded.csfloat_trade_id,
            match_score = excluded.match_score,
            confidence = excluded.confidence,
            status = CASE
              WHEN steam_csfloat_matches.status = 'manual_confirmed' THEN steam_csfloat_matches.status
              WHEN steam_csfloat_matches.status = 'rejected' THEN steam_csfloat_matches.status
              ELSE excluded.status
            END,
            reason = excluded.reason,
            updated_at = excluded.updated_at`,
        ).run({
          id: existingMatch?.id || randomUUID(),
          userId: normalizedUserId,
          steamAssetId,
          steamItemName: edge.steamItem.marketHashName || edge.steamItem.name,
          csfloatInvestmentId,
          csfloatTradeId: edge.csfloatItem.externalTradeId || null,
          matchScore: edge.score,
          confidence: edge.confidence,
          status,
          reason,
          createdAt: now,
          updatedAt: now,
        });
        matchesSuggested += 1;
      }

      return {
        imported,
        updated,
        missingMarked,
        matchesSuggested,
        matchesApplied: applyResolvedSteamCsfloatMatches(normalizedUserId),
        totalIncoming: incoming.length,
        importedItems,
      };
    },

    listPendingOperations(limit = 100) {
      return db
        .prepare(
          `SELECT * FROM operations_log
           WHERE applied_at IS NULL
           ORDER BY created_at ASC
           LIMIT ?`,
        )
        .all(Number(limit))
        .map((row) => ({
          id: row.id,
          opType: row.op_type,
          entityType: row.entity_type,
          entityId: row.entity_id,
          payload: deserialize(row.payload),
          idempotencyKey: row.idempotency_key,
          createdAt: row.created_at,
          appliedAt: row.applied_at,
        }));
    },

    markOperationApplied(id) {
      db.prepare("UPDATE operations_log SET applied_at = ? WHERE id = ?").run(
        nowIso(),
        String(id),
      );
      return true;
    },

    listSteamCsfloatMatches(userId = CANONICAL_LOCAL_USER_ID, status = null, limit = 200) {
      const normalizedUserId = normalizeLocalUserId(userId);
      maybeMigrateLegacyUserRows(normalizedUserId);
      if (status) {
        return db
          .prepare(
            `SELECT * FROM steam_csfloat_matches
             WHERE user_id = ? AND status = ?
             ORDER BY match_score DESC, updated_at DESC
             LIMIT ?`,
          )
          .all(normalizedUserId, String(status), Number(limit))
          .map(mapSteamCsfloatMatch);
      }

      return db
        .prepare(
          `SELECT * FROM steam_csfloat_matches
           WHERE user_id = ?
           ORDER BY match_score DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(normalizedUserId, Number(limit))
        .map(mapSteamCsfloatMatch);
    },

    updateSteamCsfloatMatchStatus(matchId, status = "manual_confirmed") {
      const updatedAt = nowIso();
      const normalizedStatus = String(status || "manual_confirmed");
      const matchRow = db
        .prepare(
          `SELECT user_id, steam_asset_id, csfloat_investment_id
           FROM steam_csfloat_matches
           WHERE id = ?
           LIMIT 1`,
        )
        .get(String(matchId));

      db.prepare(
        `UPDATE steam_csfloat_matches
         SET status = ?, updated_at = ?
         WHERE id = ?`,
      ).run(normalizedStatus, updatedAt, String(matchId));

      if (
        matchRow &&
        (normalizedStatus === "manual_confirmed" || normalizedStatus === "auto_linked")
      ) {
        applySteamCsfloatMatchLink(
          normalizeLocalUserId(matchRow.user_id),
          String(matchRow.steam_asset_id || ""),
          String(matchRow.csfloat_investment_id || ""),
        );
      }
      return true;
    },
  };
}
