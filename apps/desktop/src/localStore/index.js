import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const SCHEMA_VERSION = 4;

function nowIso() {
  return new Date().toISOString();
}

const DEFAULT_PORTFOLIO_PREFERENCES = Object.freeze({
  steamImportBucket: "inventory",
  csfloatImportBucket: "investment",
  metricsDisplayMode: "toggle_mode",
  metricsScopeDefault: "investments",
});

function serialize(value) {
  return JSON.stringify(value ?? {});
}

function deserialize(value, fallback = {}) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("[local-store] failed to parse JSON payload", error);
    return fallback;
  }
}

function normalizeBucket(value, fallback = "investment") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "inventory") {
    return "inventory";
  }
  if (normalized === "investment") {
    return "investment";
  }

  return fallback === "inventory" ? "inventory" : "investment";
}

function normalizeMetricsDisplayMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "always_all") {
    return "always_all";
  }
  if (normalized === "investments_only") {
    return "investments_only";
  }
  return "toggle_mode";
}

function normalizeMetricsScope(value, fallback = "investments") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  return fallback === "all" ? "all" : "investments";
}

function normalizePortfolioPreferences(input = {}) {
  return {
    steamImportBucket: normalizeBucket(
      input.steamImportBucket,
      DEFAULT_PORTFOLIO_PREFERENCES.steamImportBucket,
    ),
    csfloatImportBucket: normalizeBucket(
      input.csfloatImportBucket,
      DEFAULT_PORTFOLIO_PREFERENCES.csfloatImportBucket,
    ),
    metricsDisplayMode: normalizeMetricsDisplayMode(
      input.metricsDisplayMode ?? input.kpiDisplayMode,
    ),
    metricsScopeDefault: normalizeMetricsScope(
      input.metricsScopeDefault,
      DEFAULT_PORTFOLIO_PREFERENCES.metricsScopeDefault,
    ),
  };
}

function resolveDbPath(userDataPath) {
  return path.join(userDataPath, "cs-investor-hub.sqlite");
}

function runMigrations(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      server_id INTEGER,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'skin',
      market_hash_name TEXT,
      image_url TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      UNIQUE(server_id)
    );

    CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      server_id INTEGER,
      item_id TEXT,
      user_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'skin',
      quantity INTEGER NOT NULL DEFAULT 1,
      buy_price_usd REAL,
      funding_mode TEXT NOT NULL DEFAULT 'wallet_funded',
      payload TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      dirty INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(server_id)
    );

    CREATE TABLE IF NOT EXISTS watchlist_items (
      id TEXT PRIMARY KEY,
      server_id INTEGER,
      item_id TEXT,
      user_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'skin',
      payload TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      dirty INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(server_id)
    );

    CREATE TABLE IF NOT EXISTS item_prices (
      item_id TEXT PRIMARY KEY,
      price_usd REAL,
      price_eur REAL,
      exchange_rate REAL,
      source TEXT,
      fetched_at TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      price_usd REAL,
      price_eur REAL,
      exchange_rate REAL,
      source TEXT,
      captured_at TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      UNIQUE(item_id, captured_at)
    );

    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      captured_at TEXT NOT NULL,
      total_value_usd REAL NOT NULL DEFAULT 0,
      invested_value_usd REAL NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      UNIQUE(user_id, captured_at)
    );

    CREATE TABLE IF NOT EXISTS operations_log (
      id TEXT PRIMARY KEY,
      op_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      applied_at TEXT,
      UNIQUE(idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS steam_inventory_state (
      steam_asset_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      market_hash_name TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'skin',
      in_inventory INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_missing_at TEXT,
      payload TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS steam_csfloat_matches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      steam_asset_id TEXT NOT NULL,
      steam_item_name TEXT NOT NULL,
      csfloat_investment_id TEXT NOT NULL,
      csfloat_trade_id TEXT,
      match_score REAL NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'low',
      status TEXT NOT NULL DEFAULT 'suggested',
      reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, steam_asset_id, csfloat_investment_id)
    );

    CREATE TABLE IF NOT EXISTS sync_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      read_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_investments_user_deleted
      ON investments(user_id, deleted, updated_at);
    CREATE INDEX IF NOT EXISTS idx_watchlist_user_deleted
      ON watchlist_items(user_id, deleted, updated_at);
    CREATE INDEX IF NOT EXISTS idx_operations_pending
      ON operations_log(applied_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_steam_inventory_state_user
      ON steam_inventory_state(user_id, in_inventory, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_steam_matches_user
      ON steam_csfloat_matches(user_id, status, match_score DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_notifications_user
      ON sync_notifications(user_id, created_at DESC, read_at);
  `);

  db.prepare(
    `INSERT INTO meta (key, value, updated_at)
     VALUES ('schema_version', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(String(SCHEMA_VERSION), nowIso());
}

export function createLocalStore(userDataPath) {
  const dbPath = resolveDbPath(userDataPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  runMigrations(db);

  function appendOperation(opType, entityType, entityId, payload) {
    const createdAt = nowIso();
    const idempotencyKey = `${entityType}:${entityId}:${opType}:${createdAt}`;
    db.prepare(
      `INSERT INTO operations_log
        (id, op_type, entity_type, entity_id, payload, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      opType,
      entityType,
      entityId,
      serialize(payload),
      idempotencyKey,
      createdAt,
    );
  }

  function normalizeMarketName(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function toFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function toTimestamp(value) {
    if (!value) {
      return null;
    }
    const timestamp = Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function normalizeType(value) {
    const normalized = String(value || "skin").trim().toLowerCase();
    return normalized || "skin";
  }

  function valuesEqual(a, b) {
    if (a === b) {
      return true;
    }
    if (a === null || a === undefined) {
      return b === null || b === undefined;
    }
    if (b === null || b === undefined) {
      return false;
    }
    return String(a) === String(b);
  }

  function normalizeNameForMatching(value) {
    const normalized = normalizeMarketName(value)
      .replace(/\bstattrak\u2122?\b/g, " ")
      .replace(/\bsouvenir\b/g, " ")
      .replace(/\b(factory new|minimal wear|field-tested|well-worn|battle-scarred)\b/g, " ")
      .replace(/[^a-z0-9|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized;
  }

  function extractWearKey(value) {
    const normalized = normalizeMarketName(value);
    if (normalized.includes("factory new")) return "fn";
    if (normalized.includes("minimal wear")) return "mw";
    if (normalized.includes("field-tested")) return "ft";
    if (normalized.includes("well-worn")) return "ww";
    if (normalized.includes("battle-scarred")) return "bs";
    return null;
  }

  function splitNameTokens(value) {
    const normalized = normalizeNameForMatching(value);
    if (!normalized) {
      return [];
    }
    return normalized
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function buildTokenSet(tokens = []) {
    return new Set(tokens);
  }

  function calculateTokenOverlap(aTokens = [], bTokens = []) {
    if (aTokens.length === 0 || bTokens.length === 0) {
      return 0;
    }
    const aSet = buildTokenSet(aTokens);
    const bSet = buildTokenSet(bTokens);
    let intersection = 0;
    aSet.forEach((token) => {
      if (bSet.has(token)) {
        intersection += 1;
      }
    });
    const union = new Set([...aSet, ...bSet]).size;
    if (union <= 0) {
      return 0;
    }
    return intersection / union;
  }

  function calculateSteamCsfloatMatch(steamItem, csfloatItem) {
    const reasons = [];
    let score = 0;

    const steamType = normalizeType(steamItem.type);
    const csfloatType = normalizeType(csfloatItem.type);
    if (steamType !== csfloatType) {
      return null;
    }
    score += 12;
    reasons.push("same_type");

    const steamName = normalizeMarketName(steamItem.marketHashName || steamItem.name);
    const csfloatName = normalizeMarketName(csfloatItem.marketHashName || csfloatItem.name);
    const steamCoreName = normalizeNameForMatching(steamName);
    const csfloatCoreName = normalizeNameForMatching(csfloatName);
    if (steamCoreName && csfloatCoreName && steamCoreName === csfloatCoreName) {
      score += 50;
      reasons.push("exact_core_name");
    } else {
      const overlap = calculateTokenOverlap(
        splitNameTokens(steamCoreName),
        splitNameTokens(csfloatCoreName),
      );
      if (overlap >= 0.8) {
        score += 36;
        reasons.push("token_overlap_high");
      } else if (overlap >= 0.6) {
        score += 24;
        reasons.push("token_overlap_medium");
      } else if (overlap >= 0.4) {
        score += 12;
        reasons.push("token_overlap_low");
      } else {
        return null;
      }
    }

    const steamWear = extractWearKey(steamName);
    const csfloatWear = extractWearKey(csfloatName);
    if (steamWear && csfloatWear) {
      if (steamWear !== csfloatWear) {
        return null;
      }
      score += 8;
      reasons.push("wear_exact");
    }

    const steamFloat = toFiniteNumber(steamItem.floatValue ?? steamItem.float ?? steamItem.wearFloat);
    const csfloatFloat = toFiniteNumber(csfloatItem.floatValue ?? csfloatItem.float ?? csfloatItem.wearFloat);
    let hasFloatMatch = false;
    if (steamFloat !== null && csfloatFloat !== null) {
      const floatDiff = Math.abs(steamFloat - csfloatFloat);
      if (floatDiff > 0.03) {
        return null;
      }
      if (floatDiff <= 0.00001) {
        score += 22;
        hasFloatMatch = true;
        reasons.push("float_exact");
      } else if (floatDiff <= 0.0005) {
        score += 14;
        reasons.push("float_near");
      } else {
        score += 6;
        reasons.push("float_loose");
      }
    }

    const steamSeed = toFiniteNumber(steamItem.paintSeed ?? steamItem.patternSeed);
    const csfloatSeed = toFiniteNumber(csfloatItem.paintSeed ?? csfloatItem.patternSeed);
    let hasSeedMatch = false;
    if (steamSeed !== null && csfloatSeed !== null) {
      if (steamSeed !== csfloatSeed) {
        return null;
      }
      score += 20;
      hasSeedMatch = true;
      reasons.push("seed_exact");
    }

    const steamPrice = toFiniteNumber(steamItem.buyPriceUsd);
    const csfloatPrice = toFiniteNumber(csfloatItem.buyPriceUsd);
    if (steamPrice !== null && csfloatPrice !== null && steamPrice > 0 && csfloatPrice > 0) {
      const avgPrice = (steamPrice + csfloatPrice) / 2;
      const priceDiffRatio = avgPrice > 0 ? Math.abs(steamPrice - csfloatPrice) / avgPrice : 1;
      if (priceDiffRatio <= 0.03) {
        score += 10;
        reasons.push("price_near");
      } else if (priceDiffRatio <= 0.1) {
        score += 5;
        reasons.push("price_loose");
      }
    }

    const steamTime = toTimestamp(steamItem.firstSeenAt ?? steamItem.lastSeenAt ?? steamItem.purchasedAt);
    const csfloatTime = toTimestamp(csfloatItem.purchasedAt ?? csfloatItem.createdAt);
    if (steamTime !== null && csfloatTime !== null) {
      const dayDiff = Math.abs(steamTime - csfloatTime) / (24 * 60 * 60 * 1000);
      if (dayDiff <= 2) {
        score += 12;
        reasons.push("time_near");
      } else if (dayDiff <= 7) {
        score += 7;
        reasons.push("time_medium");
      } else if (dayDiff <= 14) {
        score += 5;
        reasons.push("time_loose");
      }
    }

    let confidence = "low";
    if ((hasFloatMatch && hasSeedMatch) || score >= 88) {
      confidence = "high";
    } else if (score >= 68) {
      confidence = "medium";
    }

    return {
      score,
      confidence,
      reasons,
    };
  }

  function mapInvestment(row) {
    const payload = deserialize(row.payload);
    const platform = String(payload?.platform || payload?.source || "").toLowerCase();
    const derivedBucket =
      platform === "steam_inventory"
        ? "inventory"
        : platform === "csfloat"
          ? "investment"
          : "investment";
    const bucket = normalizeBucket(payload?.bucket, derivedBucket);
    const excludedFlag = (() => {
      const value = payload?.excluded ?? payload?.isExcluded;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value === 1;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return ["1", "true", "yes", "on"].includes(normalized);
      }
      return false;
    })();
    return {
      ...payload,
      id: row.id,
      serverId: row.server_id,
      itemId: row.item_id,
      userId: row.user_id,
      name: row.name,
      type: row.type,
      quantity: row.quantity,
      buyPrice: row.buy_price_usd,
      buyPriceUsd: row.buy_price_usd,
      fundingMode: row.funding_mode,
      imageUrl: payload.imageUrl || payload.image_url || payload.iconUrl || payload.icon_url || null,
      bucket,
      excluded: excludedFlag,
      isExcluded: excludedFlag,
      revision: row.revision,
      dirty: Boolean(row.dirty),
      deleted: Boolean(row.deleted),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapNotification(row) {
    return {
      id: row.id,
      userId: row.user_id,
      category: row.category,
      title: row.title,
      message: row.message,
      payload: deserialize(row.payload, {}),
      createdAt: row.created_at,
      readAt: row.read_at,
      unread: !row.read_at,
    };
  }

  function mapWatchlistItem(row) {
    const payload = deserialize(row.payload);
    const resolveImageFromPayload = (value) =>
      value?.imageUrl || value?.image_url || value?.iconUrl || value?.icon_url || null;
    let imageUrl = resolveImageFromPayload(payload);

    if (!imageUrl && row?.name) {
      const fallbackRow = db
        .prepare(
          `SELECT payload
           FROM investments
           WHERE user_id = ? AND deleted = 0 AND name = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get(String(row.user_id || "local"), String(row.name));

      if (fallbackRow?.payload) {
        const fallbackPayload = deserialize(fallbackRow.payload);
        imageUrl = resolveImageFromPayload(fallbackPayload);
      }
    }

    return {
      ...payload,
      id: row.id,
      serverId: row.server_id,
      itemId: row.item_id,
      userId: row.user_id,
      name: row.name,
      type: row.type,
      imageUrl,
      revision: row.revision,
      dirty: Boolean(row.dirty),
      deleted: Boolean(row.deleted),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapPortfolioSnapshot(row) {
    return {
      id: row.id,
      userId: row.user_id,
      date: row.captured_at,
      wert: row.total_value_usd,
      investedValue: row.invested_value_usd,
      payload: deserialize(row.payload),
      capturedAt: row.captured_at,
    };
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

  const importInvestmentRows = db.transaction((rows, userId) => {
    const importedAt = nowIso();
    const statement = db.prepare(
      `INSERT INTO investments (
        id, server_id, item_id, user_id, name, type, quantity, buy_price_usd,
        funding_mode, payload, revision, dirty, deleted, created_at, updated_at
      ) VALUES (
        @id, @serverId, @itemId, @userId, @name, @type, @quantity, @buyPriceUsd,
        @fundingMode, @payload, @revision, 0, 0, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        server_id = excluded.server_id,
        item_id = excluded.item_id,
        user_id = excluded.user_id,
        name = excluded.name,
        type = excluded.type,
        quantity = excluded.quantity,
        buy_price_usd = excluded.buy_price_usd,
        funding_mode = excluded.funding_mode,
        payload = excluded.payload,
        dirty = CASE WHEN investments.dirty = 1 THEN investments.dirty ELSE 0 END,
        deleted = 0,
        updated_at = excluded.updated_at`,
    );

    rows.forEach((row) => {
      const id = String(row.id || randomUUID());
      const serverId =
        row.serverId ?? (Number.isFinite(Number(row.id)) ? Number(row.id) : null);
      const existingRow = db
        .prepare("SELECT payload FROM investments WHERE id = ? LIMIT 1")
        .get(id);
      const existingPayload = existingRow?.payload ? deserialize(existingRow.payload) : {};
      const platform = String(
        row.platform || row.source || existingPayload.platform || existingPayload.source || "",
      ).toLowerCase();
      const defaultBucket = platform === "steam_inventory" ? "inventory" : "investment";
      const payload = {
        ...existingPayload,
        ...row,
        id,
        serverId,
        bucket: normalizeBucket(row.bucket ?? existingPayload.bucket, defaultBucket),
        importedAt,
      };

      statement.run({
        id,
        serverId,
        itemId: row.itemId ? String(row.itemId) : null,
        userId: String(row.userId || userId || "local"),
        name: String(row.name || row.marketHashName || row.itemName || ""),
        type: String(row.type || "skin"),
        quantity: Number(row.quantity || 1),
        buyPriceUsd: row.buyPriceUsd === undefined ? null : Number(row.buyPriceUsd),
        fundingMode: String(row.fundingMode || "wallet_funded"),
        payload: serialize(payload),
        revision: Number(row.revision || 1),
        createdAt: row.createdAt || importedAt,
        updatedAt: row.updatedAt || row.lastPriceUpdateAt || importedAt,
      });
    });
  });

  const importWatchlistRows = db.transaction((rows, userId) => {
    const importedAt = nowIso();
    const statement = db.prepare(
      `INSERT INTO watchlist_items (
        id, server_id, item_id, user_id, name, type, payload, revision,
        dirty, deleted, created_at, updated_at
      ) VALUES (
        @id, @serverId, @itemId, @userId, @name, @type, @payload, @revision,
        0, 0, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        server_id = excluded.server_id,
        item_id = excluded.item_id,
        user_id = excluded.user_id,
        name = excluded.name,
        type = excluded.type,
        payload = excluded.payload,
        dirty = CASE WHEN watchlist_items.dirty = 1 THEN watchlist_items.dirty ELSE 0 END,
        deleted = 0,
        updated_at = excluded.updated_at`,
    );

    rows.forEach((row) => {
      const id = String(row.id || randomUUID());
      const serverId =
        row.serverId ?? (Number.isFinite(Number(row.id)) ? Number(row.id) : null);
      const normalizedUserId = String(row.userId || userId || "local");
      const resolvedName = String(row.name || row.marketHashName || "");
      const existingRow = db
        .prepare("SELECT payload FROM watchlist_items WHERE id = ? LIMIT 1")
        .get(id);
      const existingPayload = existingRow?.payload ? deserialize(existingRow.payload) : {};
      const resolveImageFromPayload = (value) =>
        value?.imageUrl || value?.image_url || value?.iconUrl || value?.icon_url || null;
      let resolvedImageUrl = resolveImageFromPayload(row) || resolveImageFromPayload(existingPayload);

      if (!resolvedImageUrl && resolvedName) {
        const fallbackRow = db
          .prepare(
            `SELECT payload
             FROM investments
             WHERE user_id = ? AND deleted = 0 AND name = ?
             ORDER BY updated_at DESC
             LIMIT 1`,
          )
          .get(normalizedUserId, resolvedName);

        if (fallbackRow?.payload) {
          const fallbackPayload = deserialize(fallbackRow.payload);
          resolvedImageUrl = resolveImageFromPayload(fallbackPayload);
        }
      }

      const payload = {
        ...(existingPayload || {}),
        ...row,
        id,
        serverId,
        userId: normalizedUserId,
        name: resolvedName,
        imageUrl: resolvedImageUrl || null,
        importedAt,
      };

      statement.run({
        id,
        serverId,
        itemId: row.itemId ? String(row.itemId) : null,
        userId: normalizedUserId,
        name: resolvedName,
        type: String(row.type || "skin"),
        payload: serialize(payload),
        revision: Number(row.revision || 1),
        createdAt: row.createdAt || importedAt,
        updatedAt: row.updatedAt || row.lastPriceUpdateAt || importedAt,
      });
    });
  });

  return {
    getInfo() {
      return {
        dbPath,
        schemaVersion: SCHEMA_VERSION,
        investments: db
          .prepare("SELECT COUNT(*) AS count FROM investments WHERE deleted = 0")
          .get().count,
        watchlistItems: db
          .prepare("SELECT COUNT(*) AS count FROM watchlist_items WHERE deleted = 0")
          .get().count,
        pendingOperations: db
          .prepare("SELECT COUNT(*) AS count FROM operations_log WHERE applied_at IS NULL")
          .get().count,
      };
    },

    listInvestments(userId = "local") {
      return db
        .prepare(
          `SELECT * FROM investments
           WHERE user_id = ? AND deleted = 0
           ORDER BY updated_at DESC`,
        )
        .all(String(userId))
        .map(mapInvestment);
    },

    syncSteamInventory(items = [], userId = "local") {
      const normalizedUserId = String(userId || "local");
      const now = nowIso();
      const preferences = this.getPortfolioPreferences(normalizedUserId);
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
      const allInvestments = this.listInvestments(normalizedUserId);
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
          this.upsertInvestment(upsertPayload);
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
          this.upsertInvestment({
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
        return platform === "csfloat" || String(investment.id || "").startsWith("csfloat-");
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
          createdAt: existingMatch ? now : now,
          updatedAt: now,
        });
        matchesSuggested += 1;
      }

      return {
        imported,
        updated,
        missingMarked,
        matchesSuggested,
        totalIncoming: incoming.length,
        importedItems,
      };
    },

    importInvestments(rows = [], userId = "local") {
      if (!Array.isArray(rows) || rows.length === 0) {
        return { imported: 0 };
      }

      importInvestmentRows(rows, userId);
      return { imported: rows.length };
    },

    upsertInvestment(input = {}) {
      const id = String(input.id || randomUUID());
      const createdAt = input.createdAt || nowIso();
      const updatedAt = nowIso();
      const platform = String(input.platform || input.source || "").trim().toLowerCase();
      const defaultBucket =
        platform === "steam_inventory"
          ? "inventory"
          : platform === "csfloat"
            ? "investment"
            : "investment";
      const bucket = normalizeBucket(input.bucket, defaultBucket);
      const payload = {
        ...input,
        id,
        bucket,
        updatedAt,
      };

      db.prepare(
        `INSERT INTO investments (
          id, server_id, item_id, user_id, name, type, quantity, buy_price_usd,
          funding_mode, payload, revision, dirty, deleted, created_at, updated_at
        ) VALUES (
          @id, @serverId, @itemId, @userId, @name, @type, @quantity, @buyPriceUsd,
          @fundingMode, @payload, @revision, 1, 0, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          server_id = excluded.server_id,
          item_id = excluded.item_id,
          user_id = excluded.user_id,
          name = excluded.name,
          type = excluded.type,
          quantity = excluded.quantity,
          buy_price_usd = excluded.buy_price_usd,
          funding_mode = excluded.funding_mode,
          payload = excluded.payload,
          revision = investments.revision + 1,
          dirty = 1,
          deleted = 0,
          updated_at = excluded.updated_at`,
      ).run({
        id,
        serverId: input.serverId ?? null,
        itemId: input.itemId ? String(input.itemId) : null,
        userId: String(input.userId || "local"),
        name: String(input.name || input.marketHashName || input.itemName || ""),
        type: String(input.type || input.itemType || "skin"),
        quantity: Number(input.quantity || 1),
        buyPriceUsd:
          input.buyPriceUsd === undefined
            ? (input.buyPrice === undefined ? null : Number(input.buyPrice))
            : Number(input.buyPriceUsd),
        fundingMode: String(input.fundingMode || "wallet_funded"),
        payload: serialize(payload),
        revision: Number(input.revision || 1),
        createdAt,
        updatedAt,
      });

      appendOperation("upsert", "investment", id, payload);
      return this.getInvestment(id);
    },

    getInvestment(id) {
      const row = db.prepare("SELECT * FROM investments WHERE id = ?").get(String(id));
      return row ? mapInvestment(row) : null;
    },

    getMetaValue(key, fallback = null) {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = ? LIMIT 1")
        .get(String(key));
      if (!row || typeof row.value !== "string") {
        return fallback;
      }
      return row.value;
    },

    setMetaValue(key, value) {
      db.prepare(
        `INSERT INTO meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(String(key), String(value), nowIso());
      return true;
    },

    getPortfolioPreferences(userId = "local") {
      const normalizedUserId = String(userId || "local");
      const prefix = `portfolio_pref:${normalizedUserId}:`;
      const rows = db
        .prepare(
          `SELECT key, value
           FROM meta
           WHERE key LIKE ?`,
        )
        .all(`${prefix}%`);

      const parsed = {};
      rows.forEach((row) => {
        const key = String(row.key || "");
        if (!key.startsWith(prefix)) {
          return;
        }
        const preferenceKey = key.slice(prefix.length);
        parsed[preferenceKey] = String(row.value || "");
      });

      return normalizePortfolioPreferences(parsed);
    },

    updatePortfolioPreferences(userId = "local", patch = {}) {
      const normalizedUserId = String(userId || "local");
      const current = this.getPortfolioPreferences(normalizedUserId);
      const next = normalizePortfolioPreferences({
        ...current,
        ...(patch || {}),
      });
      const prefix = `portfolio_pref:${normalizedUserId}:`;
      const updatedAt = nowIso();

      const upsert = db.prepare(
        `INSERT INTO meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      );

      upsert.run(`${prefix}steamImportBucket`, next.steamImportBucket, updatedAt);
      upsert.run(`${prefix}csfloatImportBucket`, next.csfloatImportBucket, updatedAt);
      upsert.run(`${prefix}metricsDisplayMode`, next.metricsDisplayMode, updatedAt);
      upsert.run(`${prefix}metricsScopeDefault`, next.metricsScopeDefault, updatedAt);

      return next;
    },

    deleteInvestment(id) {
      const updatedAt = nowIso();
      db.prepare(
        `UPDATE investments
         SET deleted = 1, dirty = 1, revision = revision + 1, updated_at = ?
         WHERE id = ?`,
      ).run(updatedAt, String(id));
      appendOperation("delete", "investment", String(id), { id, updatedAt });
      return true;
    },

    deleteInvestmentSilent(id) {
      const updatedAt = nowIso();
      db.prepare(
        `UPDATE investments
         SET deleted = 1, dirty = 0, updated_at = ?
         WHERE id = ?`,
      ).run(updatedAt, String(id));
      return true;
    },

    listWatchlistItems(userId = "local") {
      return db
        .prepare(
          `SELECT * FROM watchlist_items
           WHERE user_id = ? AND deleted = 0
           ORDER BY updated_at DESC`,
        )
        .all(String(userId))
        .map(mapWatchlistItem);
    },

    listPortfolioSnapshots(userId = "local", limit = 365) {
      return db
        .prepare(
          `SELECT * FROM portfolio_snapshots
           WHERE user_id = ?
           ORDER BY captured_at ASC
           LIMIT ?`,
        )
        .all(String(userId), Number(limit))
        .map(mapPortfolioSnapshot);
    },

    upsertPortfolioSnapshot(input = {}) {
      const id = String(input.id || randomUUID());
      const userId = String(input.userId || "local");
      const capturedAt = input.capturedAt || input.date || nowIso();
      const payload = {
        ...input.payload,
        capturedAt,
      };

      db.prepare(
        `INSERT INTO portfolio_snapshots (
          id, user_id, captured_at, total_value_usd, invested_value_usd, payload
        ) VALUES (
          @id, @userId, @capturedAt, @totalValueUsd, @investedValueUsd, @payload
        )
        ON CONFLICT(user_id, captured_at) DO UPDATE SET
          id = excluded.id,
          total_value_usd = excluded.total_value_usd,
          invested_value_usd = excluded.invested_value_usd,
          payload = excluded.payload`,
      ).run({
        id,
        userId,
        capturedAt,
        totalValueUsd: Number(input.totalValueUsd || 0),
        investedValueUsd: Number(input.investedValueUsd || 0),
        payload: serialize(payload),
      });

      return this.listPortfolioSnapshots(userId).at(-1) || mapPortfolioSnapshot({
        id,
        user_id: userId,
        captured_at: capturedAt,
        total_value_usd: Number(input.totalValueUsd || 0),
        invested_value_usd: Number(input.investedValueUsd || 0),
        payload: serialize(payload),
      });
    },

    importWatchlistItems(rows = [], userId = "local") {
      if (!Array.isArray(rows) || rows.length === 0) {
        return { imported: 0 };
      }

      importWatchlistRows(rows, userId);
      return { imported: rows.length };
    },

    upsertWatchlistItem(input = {}) {
      const id = String(input.id || randomUUID());
      const createdAt = input.createdAt || nowIso();
      const updatedAt = nowIso();
      const payload = {
        ...input,
        id,
        updatedAt,
      };

      db.prepare(
        `INSERT INTO watchlist_items (
          id, server_id, item_id, user_id, name, type, payload, revision,
          dirty, deleted, created_at, updated_at
        ) VALUES (
          @id, @serverId, @itemId, @userId, @name, @type, @payload, @revision,
          1, 0, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          server_id = excluded.server_id,
          item_id = excluded.item_id,
          user_id = excluded.user_id,
          name = excluded.name,
          type = excluded.type,
          payload = excluded.payload,
          revision = watchlist_items.revision + 1,
          dirty = 1,
          deleted = 0,
          updated_at = excluded.updated_at`,
      ).run({
        id,
        serverId: input.serverId ?? null,
        itemId: input.itemId ? String(input.itemId) : null,
        userId: String(input.userId || "local"),
        name: String(input.name || ""),
        type: String(input.type || "skin"),
        payload: serialize(payload),
        revision: Number(input.revision || 1),
        createdAt,
        updatedAt,
      });

      appendOperation("upsert", "watchlist_item", id, payload);
      return this.getWatchlistItem(id);
    },

    getWatchlistItem(id) {
      const row = db.prepare("SELECT * FROM watchlist_items WHERE id = ?").get(String(id));
      return row ? mapWatchlistItem(row) : null;
    },

    deleteWatchlistItem(id) {
      const updatedAt = nowIso();
      db.prepare(
        `UPDATE watchlist_items
         SET deleted = 1, dirty = 1, revision = revision + 1, updated_at = ?
         WHERE id = ?`,
      ).run(updatedAt, String(id));
      appendOperation("delete", "watchlist_item", String(id), { id, updatedAt });
      return true;
    },

    deleteWatchlistItemSilent(id) {
      const updatedAt = nowIso();
      db.prepare(
        `UPDATE watchlist_items
         SET deleted = 1, dirty = 0, updated_at = ?
         WHERE id = ?`,
      ).run(updatedAt, String(id));
      return true;
    },

    upsertPrice(input = {}) {
      const itemId = String(input.itemId || input.item_id || "");
      if (!itemId) {
        throw new Error("itemId is required for local price upsert");
      }

      const fetchedAt = input.fetchedAt || nowIso();
      const payload = serialize(input);
      db.prepare(
        `INSERT INTO item_prices
          (item_id, price_usd, price_eur, exchange_rate, source, fetched_at, payload)
         VALUES (@itemId, @priceUsd, @priceEur, @exchangeRate, @source, @fetchedAt, @payload)
         ON CONFLICT(item_id) DO UPDATE SET
          price_usd = excluded.price_usd,
          price_eur = excluded.price_eur,
          exchange_rate = excluded.exchange_rate,
          source = excluded.source,
          fetched_at = excluded.fetched_at,
          payload = excluded.payload`,
      ).run({
        itemId,
        priceUsd: input.priceUsd ?? null,
        priceEur: input.priceEur ?? null,
        exchangeRate: input.exchangeRate ?? null,
        source: input.source || null,
        fetchedAt,
        payload,
      });

      db.prepare(
        `INSERT OR IGNORE INTO price_history
          (id, item_id, price_usd, price_eur, exchange_rate, source, captured_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        itemId,
        input.priceUsd ?? null,
        input.priceEur ?? null,
        input.exchangeRate ?? null,
        input.source || null,
        fetchedAt,
        payload,
      );

      return { itemId, fetchedAt };
    },

    listPriceHistory(itemId, limitDays = 370) {
      const resolvedItemId = String(itemId || "");
      if (!resolvedItemId) {
        return [];
      }

      const days = Math.max(1, Number(limitDays || 370));
      const fromTimestamp = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      return db
        .prepare(
          `SELECT captured_at, price_usd, price_eur, exchange_rate, source
           FROM price_history
           WHERE item_id = ? AND captured_at >= ?
           ORDER BY captured_at ASC`,
        )
        .all(resolvedItemId, fromTimestamp)
        .map((row) => ({
          date: row.captured_at,
          priceUsd: row.price_usd ?? null,
          priceEur: row.price_eur ?? null,
          exchangeRate: row.exchange_rate ?? null,
          source: row.source ?? null,
        }));
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

    listSteamCsfloatMatches(userId = "local", status = null, limit = 200) {
      const normalizedUserId = String(userId || "local");
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

    createNotification(input = {}) {
      const id = String(input.id || randomUUID());
      const userId = String(input.userId || "local");
      const category = String(input.category || "steam_sync");
      const title = String(input.title || "Neue Synchronisation");
      const message = String(input.message || "");
      const createdAt = input.createdAt || nowIso();
      const payload = serialize(input.payload || {});
      db.prepare(
        `INSERT INTO sync_notifications (
          id, user_id, category, title, message, payload, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(id, userId, category, title, message, payload, createdAt);
      return this.getNotificationById(id);
    },

    getNotificationById(id) {
      const row = db.prepare("SELECT * FROM sync_notifications WHERE id = ?").get(String(id));
      return row ? mapNotification(row) : null;
    },

    listNotifications(userId = "local", options = {}) {
      const normalizedUserId = String(userId || "local");
      const limit = Number(options?.limit || 20);
      const unreadOnly = Boolean(options?.unreadOnly);

      if (unreadOnly) {
        return db
          .prepare(
            `SELECT * FROM sync_notifications
             WHERE user_id = ? AND read_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(normalizedUserId, limit)
          .map(mapNotification);
      }

      return db
        .prepare(
          `SELECT * FROM sync_notifications
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(normalizedUserId, limit)
        .map(mapNotification);
    },

    markNotificationRead(id) {
      db.prepare(
        `UPDATE sync_notifications
         SET read_at = COALESCE(read_at, ?)
         WHERE id = ?`,
      ).run(nowIso(), String(id));
      return true;
    },

    markAllNotificationsRead(userId = "local", category = null) {
      const normalizedUserId = String(userId || "local");
      if (category) {
        db.prepare(
          `UPDATE sync_notifications
           SET read_at = COALESCE(read_at, ?)
           WHERE user_id = ? AND category = ? AND read_at IS NULL`,
        ).run(nowIso(), normalizedUserId, String(category));
        return true;
      }
      db.prepare(
        `UPDATE sync_notifications
         SET read_at = COALESCE(read_at, ?)
         WHERE user_id = ? AND read_at IS NULL`,
      ).run(nowIso(), normalizedUserId);
      return true;
    },

    updateSteamCsfloatMatchStatus(matchId, status = "manual_confirmed") {
      const updatedAt = nowIso();
      db.prepare(
        `UPDATE steam_csfloat_matches
         SET status = ?, updated_at = ?
         WHERE id = ?`,
      ).run(String(status), updatedAt, String(matchId));
      return true;
    },

    markOperationApplied(id) {
      db.prepare("UPDATE operations_log SET applied_at = ? WHERE id = ?").run(
        nowIso(),
        String(id),
      );
      return true;
    },

    close() {
      db.close();
    },
  };
}
