import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import {
  nowIso,
  resolveDbPath,
  CANONICAL_LOCAL_USER_ID,
  SCHEMA_VERSION,
} from "./utils.js";

import { createInvestmentStore } from "./investments.js";
import { createWatchlistStore } from "./watchlist.js";
import { createSettingsStore } from "./settings.js";
import { createPriceStore } from "./prices.js";
import { createSnapshotStore } from "./snapshots.js";
import { createNotificationStore } from "./notifications.js";
import { createSyncStore } from "./sync.js";

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
      user_id TEXT NOT NULL DEFAULT '1',
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
      user_id TEXT NOT NULL DEFAULT '1',
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
      user_id TEXT NOT NULL DEFAULT '1',
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
      user_id TEXT NOT NULL DEFAULT '1',
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
      user_id TEXT NOT NULL DEFAULT '1',
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
      user_id TEXT NOT NULL DEFAULT '1',
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

  const legacyUserWhere =
    "user_id IS NULL OR TRIM(user_id) = '' OR lower(user_id) = 'local'";
  db.exec(`
    UPDATE investments SET user_id = '${CANONICAL_LOCAL_USER_ID}' WHERE ${legacyUserWhere};
    UPDATE watchlist_items SET user_id = '${CANONICAL_LOCAL_USER_ID}' WHERE ${legacyUserWhere};
    UPDATE portfolio_snapshots SET user_id = '${CANONICAL_LOCAL_USER_ID}' WHERE ${legacyUserWhere};
    UPDATE steam_inventory_state SET user_id = '${CANONICAL_LOCAL_USER_ID}' WHERE ${legacyUserWhere};
    UPDATE steam_csfloat_matches SET user_id = '${CANONICAL_LOCAL_USER_ID}' WHERE ${legacyUserWhere};
    UPDATE sync_notifications SET user_id = '${CANONICAL_LOCAL_USER_ID}' WHERE ${legacyUserWhere};
  `);

  const legacyPreferenceRows = db
    .prepare(
      `SELECT key, value
       FROM meta
       WHERE key LIKE 'portfolio_pref:local:%'`,
    )
    .all();
  const now = nowIso();
  const upsertMeta = db.prepare(
    `INSERT INTO meta (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const deleteMeta = db.prepare("DELETE FROM meta WHERE key = ?");
  legacyPreferenceRows.forEach((row) => {
    const key = String(row?.key || "");
    const suffixIndex = key.lastIndexOf(":");
    if (suffixIndex <= 0 || suffixIndex >= key.length - 1) {
      return;
    }
    const preferenceKey = key.slice(suffixIndex + 1);
    const canonicalKey = `portfolio_pref:${CANONICAL_LOCAL_USER_ID}:${preferenceKey}`;
    upsertMeta.run(canonicalKey, String(row?.value || ""), now);
    deleteMeta.run(key);
  });
}

export function createLocalStore(userDataPath) {
  const dbPath = resolveDbPath(userDataPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  runMigrations(db);

  // Create all sub-stores
  const investmentStore = createInvestmentStore(db);
  const watchlistStore = createWatchlistStore(db);
  const settingsStore = createSettingsStore(db);
  const priceStore = createPriceStore(db);
  const snapshotStore = createSnapshotStore(db);

  // Sync store needs dependencies from investments and settings
  const syncStore = createSyncStore(db, {
    upsertInvestment: investmentStore.upsertInvestment,
    getPortfolioPreferences: settingsStore.getPortfolioPreferences,
  });

  // Notification store needs maybeMigrateLegacyUserRows from sync
  const notificationStore = createNotificationStore(db, {
    migrateLegacy: syncStore.maybeMigrateLegacyUserRows,
  });

  // Merge all methods into a single return object.
  // Order matters for duplicate keys: later spreads overwrite earlier ones.
  // settingsStore has close() which is the same as the original.
  return {
    ...investmentStore,
    ...watchlistStore,
    ...settingsStore,
    ...priceStore,
    ...snapshotStore,
    ...syncStore,
    ...notificationStore,
  };
}
