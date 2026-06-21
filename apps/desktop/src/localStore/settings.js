import { statSync } from "fs";
import {
  nowIso,
  normalizeLocalUserId,
  normalizePortfolioPreferences,
  CANONICAL_LOCAL_USER_ID,
} from "./utils.js";

export function createSettingsStore(db) {
  return {
    getInfo() {
      return {
        dbPath: db.name,
        schemaVersion: (() => {
          const row = db
            .prepare("SELECT value FROM meta WHERE key = 'schema_version' LIMIT 1")
            .get();
          return row ? Number(row.value) : null;
        })(),
        size: (() => {
          try {
            const stat = statSync(db.name);
            return stat.size;
          } catch {
            return null;
          }
        })(),
      };
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

    getPortfolioPreferences(userId = CANONICAL_LOCAL_USER_ID) {
      const normalizedUserId = normalizeLocalUserId(userId);
      const prefix = `portfolio_pref:${normalizedUserId}:`;
      const rows = db
        .prepare("SELECT key, value FROM meta WHERE key LIKE ?")
        .all(`${prefix}%`);

      const parsed = {};
      rows.forEach((row) => {
        const key = String(row.key || "");
        if (!key.startsWith(prefix)) {
          return;
        }
        const preferenceKey = key.slice(prefix.length);
        parsed[preferenceKey] = row.value;
      });

      return normalizePortfolioPreferences(parsed);
    },

    updatePortfolioPreferences(userId = CANONICAL_LOCAL_USER_ID, patch = {}) {
      const normalizedUserId = normalizeLocalUserId(userId);
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
      upsert.run(`${prefix}skinBaronImportBucket`, next.skinBaronImportBucket, updatedAt);
      upsert.run(`${prefix}metricsDisplayMode`, next.metricsDisplayMode, updatedAt);
      upsert.run(`${prefix}metricsScopeDefault`, next.metricsScopeDefault, updatedAt);
      // Booleans must be stored as strings (better-sqlite3 cannot bind booleans);
      // normalizePortfolioPreferences coerces the "true"/"false" string on read.
      upsert.run(`${prefix}csfloatWatchlistAutoImport`, String(next.csfloatWatchlistAutoImport), updatedAt);
      upsert.run(`${prefix}notifyBanWaveDesktop`, String(next.notifyBanWaveDesktop), updatedAt);
      upsert.run(`${prefix}notifyBanWaveDesktopMinLevel`, next.notifyBanWaveDesktopMinLevel, updatedAt);
      upsert.run(`${prefix}notifyCsUpdatesDesktop`, String(next.notifyCsUpdatesDesktop), updatedAt);
      upsert.run(`${prefix}notifyCsUpdatesDesktopMinLevel`, next.notifyCsUpdatesDesktopMinLevel, updatedAt);
      upsert.run(`${prefix}notifySteamSyncDesktop`, String(next.notifySteamSyncDesktop), updatedAt);
      upsert.run(`${prefix}notifyBanWaveWebPush`, String(next.notifyBanWaveWebPush), updatedAt);
      upsert.run(`${prefix}notifyBanWaveWebPushMinLevel`, next.notifyBanWaveWebPushMinLevel, updatedAt);
      upsert.run(`${prefix}notifyCsUpdatesWebPush`, String(next.notifyCsUpdatesWebPush), updatedAt);
      upsert.run(`${prefix}notifyCsUpdatesWebPushMinLevel`, next.notifyCsUpdatesWebPushMinLevel, updatedAt);

      return next;
    },

    close() {
      db.close();
    },
  };
}
