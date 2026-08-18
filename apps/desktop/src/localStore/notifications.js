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
    // The stored text is the fallback; the renderer prefers the key when one is
    // present, so a language switch retranslates the row instead of leaving the
    // language it happened to be written in.
    title: row.title,
    message: row.message,
    titleKey: row.title_key || null,
    messageKey: row.message_key || null,
    params: deserialize(row.params_json, null),
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
      const title = String(input.title || "");
      const message = String(input.message || "");
      const titleKey = input.titleKey ? String(input.titleKey) : null;
      const messageKey = input.messageKey ? String(input.messageKey) : null;
      const params = input.params ? serialize(input.params) : null;
      const createdAt = input.createdAt || nowIso();
      const payloadObject = input.payload || {};
      const payload = serialize(payloadObject);
      const dedupeWindowHours = Number(input.dedupeWindowHours ?? 24);
      const dedupeWindowMs =
        Number.isFinite(dedupeWindowHours) && dedupeWindowHours > 0
          ? dedupeWindowHours * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;

      const incomingPayloadStable = stableSerialize(payloadObject);
      // Dedupe on the key when there is one, on the rendered text otherwise.
      // Matching on the text alone would treat the same notification written
      // before and after a language switch as two different ones.
      const existingRows = titleKey
        ? db
            .prepare(
              `SELECT *
               FROM sync_notifications
               WHERE user_id = ? AND category = ? AND title_key IS ? AND message_key IS ?
               ORDER BY created_at DESC
               LIMIT 50`,
            )
            .all(userId, category, titleKey, messageKey)
        : db
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
        if (existingPayloadStable !== incomingPayloadStable) {
          continue;
        }
        // For keyed rows the params carry the varying figures (a price, a
        // count), so two rows with the same key but different params are
        // genuinely different notifications.
        if (titleKey) {
          const existingParamsStable = stableSerialize(deserialize(row.params_json, null));
          if (existingParamsStable !== stableSerialize(input.params ?? null)) {
            continue;
          }
        }
        return mapNotification(row);
      }

      db.prepare(
        `INSERT INTO sync_notifications (
          id, user_id, category, title, message, payload, created_at, read_at,
          title_key, message_key, params_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(
        id, userId, category, title, message, payload, createdAt,
        titleKey, messageKey, params,
      );

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
