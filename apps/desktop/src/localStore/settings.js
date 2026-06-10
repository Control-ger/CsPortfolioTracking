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

      return next;
    },

    close() {
      db.close();
    },
  };
}
