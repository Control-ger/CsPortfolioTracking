import { randomUUID } from "crypto";
import {
  nowIso,
  normalizeLocalUserId,
  serialize,
  stableSerialize,
  deserialize,
  CANONICAL_LOCAL_USER_ID,
} from "./utils.js";

export function mapNotification(row) {
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

export function createNotificationStore(
  db,
  { migrateLegacy } = {},
) {
  return {
    createNotification(input = {}) {
      const id = String(input.id || randomUUID());
      const userId = normalizeLocalUserId(input.userId);
      const category = String(input.category || "steam_sync");
      const title = String(input.title || "Neue Synchronisation");
      const message = String(input.message || "");
      const createdAt = input.createdAt || nowIso();
      const payloadObject = input.payload || {};
      const payload = serialize(payloadObject);
      const dedupeWindowHours = Number(input.dedupeWindowHours ?? 24);
      const dedupeWindowMs =
        Number.isFinite(dedupeWindowHours) && dedupeWindowHours > 0
          ? dedupeWindowHours * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;

      const incomingPayloadStable = stableSerialize(payloadObject);
      const existingRows = db
        .prepare(
          `SELECT *
           FROM sync_notifications
           WHERE user_id = ? AND category = ? AND title = ? AND message = ?
           ORDER BY created_at DESC
           LIMIT 50`,
        )
        .all(userId, category, title, message);

      for (const row of existingRows) {
        const existingCreatedAtMs = Date.parse(String(row.created_at || ""));
        if (!Number.isFinite(existingCreatedAtMs)) {
          continue;
        }
        if (Date.now() - existingCreatedAtMs > dedupeWindowMs) {
          continue;
        }

        const existingPayloadStable = stableSerialize(
          deserialize(row.payload, {}),
        );
        if (existingPayloadStable === incomingPayloadStable) {
          return mapNotification(row);
        }
      }

      db.prepare(
        `INSERT INTO sync_notifications (
          id, user_id, category, title, message, payload, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(id, userId, category, title, message, payload, createdAt);

      const row = db
        .prepare("SELECT * FROM sync_notifications WHERE id = ? LIMIT 1")
        .get(id);
      return row ? mapNotification(row) : null;
    },

    getNotificationById(id) {
      const row = db
        .prepare("SELECT * FROM sync_notifications WHERE id = ? LIMIT 1")
        .get(String(id));
      return row ? mapNotification(row) : null;
    },

    listNotifications(
      userId = CANONICAL_LOCAL_USER_ID,
      options = {},
    ) {
      const normalizedUserId = normalizeLocalUserId(userId);
      if (typeof migrateLegacy === "function") {
        migrateLegacy(normalizedUserId);
      }
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

    markAllNotificationsRead(
      userId = CANONICAL_LOCAL_USER_ID,
      category = null,
    ) {
      const normalizedUserId = normalizeLocalUserId(userId);
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

    // Notifications are an action inbox: reading/acting on one removes it
    // entirely rather than leaving a greyed-out historical row.
    deleteNotification(id) {
      db.prepare(`DELETE FROM sync_notifications WHERE id = ?`).run(String(id));
      return true;
    },

    deleteAllNotifications(
      userId = CANONICAL_LOCAL_USER_ID,
      category = null,
    ) {
      const normalizedUserId = normalizeLocalUserId(userId);
      if (category) {
        db.prepare(
          `DELETE FROM sync_notifications WHERE user_id = ? AND category = ?`,
        ).run(normalizedUserId, String(category));
        return true;
      }
      db.prepare(
        `DELETE FROM sync_notifications WHERE user_id = ?`,
      ).run(normalizedUserId);
      return true;
    },
  };
}
