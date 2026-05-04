import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const SCHEMA_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

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

    CREATE INDEX IF NOT EXISTS idx_investments_user_deleted
      ON investments(user_id, deleted, updated_at);
    CREATE INDEX IF NOT EXISTS idx_watchlist_user_deleted
      ON watchlist_items(user_id, deleted, updated_at);
    CREATE INDEX IF NOT EXISTS idx_operations_pending
      ON operations_log(applied_at, created_at);
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

  function mapInvestment(row) {
    return {
      ...deserialize(row.payload),
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
      revision: row.revision,
      dirty: Boolean(row.dirty),
      deleted: Boolean(row.deleted),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapWatchlistItem(row) {
    return {
      ...deserialize(row.payload),
      id: row.id,
      serverId: row.server_id,
      itemId: row.item_id,
      userId: row.user_id,
      name: row.name,
      type: row.type,
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
      const payload = {
        ...row,
        id,
        serverId,
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
      const payload = {
        ...row,
        id,
        serverId,
        importedAt,
      };

      statement.run({
        id,
        serverId,
        itemId: row.itemId ? String(row.itemId) : null,
        userId: String(row.userId || userId || "local"),
        name: String(row.name || ""),
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
      const payload = {
        ...input,
        id,
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

    close() {
      db.close();
    },
  };
}
