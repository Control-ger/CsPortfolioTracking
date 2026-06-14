import { randomUUID } from "crypto";
import {
  nowIso,
  serialize,
  deserialize,
  normalizeLocalUserId,
} from "./utils.js";

export function mapWatchlistItem(row) {
  const payload = deserialize(row.payload);
  const resolveImageFromPayload = (value) =>
    value?.imageUrl || value?.image_url || value?.iconUrl || value?.icon_url || null;
  let imageUrl = resolveImageFromPayload(payload);

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

export function createImportWatchlistRowsTransaction(db) {
  return db.transaction((rows, userId) => {
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
        revision = excluded.revision,
        dirty = CASE WHEN watchlist_items.dirty = 1 THEN watchlist_items.dirty ELSE 0 END,
        deleted = 0,
        updated_at = excluded.updated_at`,
    );
    // server_id is the server's watchlist.id, which is UNIQUE(user_id, item_id) and
    // never reused (AUTO_INCREMENT). So two local rows that carry the same server_id
    // are always the *same* logical item — the server can legitimately emit a fresh
    // local id (e.g. after a re-add) for a watchlist row that an older local id still
    // owns. The import upsert only reconciles ON CONFLICT(id), so without this the
    // INSERT would violate UNIQUE(server_id) and abort the whole pull. A hard DELETE
    // is required: a soft-deleted (deleted=1) row still occupies its server_id in the
    // unique index, so tombstoning would not release the collision.
    const releaseServerId = db.prepare(
      "DELETE FROM watchlist_items WHERE server_id = ? AND id != ?",
    );

    rows.forEach((row) => {
      const id = String(row.id || randomUUID());
      const serverId =
        row.serverId ?? (Number.isFinite(Number(row.id)) ? Number(row.id) : null);
      if (serverId !== null && serverId !== undefined) {
        releaseServerId.run(serverId, id);
      }
      const normalizedUserId = normalizeLocalUserId(row.userId || userId);
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
}

export function createWatchlistStore(db) {
  const importWatchlistRows = createImportWatchlistRowsTransaction(db);

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

  function resolveImageFromWatchlistPayload(row) {
    const payload = deserialize(row.payload);
    const resolveFromPayload = (value) =>
      value?.imageUrl || value?.image_url || value?.iconUrl || value?.icon_url || null;
    let imageUrl = resolveFromPayload(payload);

    if (!imageUrl && row?.name) {
      const fallbackRow = db
        .prepare(
          `SELECT payload
           FROM investments
           WHERE user_id = ? AND deleted = 0 AND name = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get(normalizeLocalUserId(row.user_id), String(row.name));

      if (fallbackRow?.payload) {
        const fallbackPayload = deserialize(fallbackRow.payload);
        imageUrl = resolveFromPayload(fallbackPayload);
      }
    }
    return imageUrl;
  }

  return {
    importWatchlistRows,

    listWatchlistItems(userId = "1") {
      return db
        .prepare(
          `SELECT * FROM watchlist_items
           WHERE user_id = ? AND deleted = 0
           ORDER BY updated_at DESC`,
        )
        .all(normalizeLocalUserId(userId))
        .map(mapWatchlistItem);
    },

    importWatchlistItems(rows = [], userId = "1") {
      if (!Array.isArray(rows) || rows.length === 0) {
        return { imported: 0 };
      }
      importWatchlistRows(rows, userId);
      return { imported: rows.length };
    },

    upsertWatchlistItem(input = {}) {
      const now = nowIso();
      const id = String(input.id || randomUUID());
      const existing = db
        .prepare(
          `SELECT * FROM watchlist_items WHERE id = ? AND deleted = 0 LIMIT 1`,
        )
        .get(id);

      const name = String(
        input.name || input.marketHashName || input.itemName || existing?.name || "",
      );

      const payload = {
        ...(existing?.payload ? deserialize(existing.payload) : {}),
        ...input,
        id,
        name,
        importedAt: existing?.payload ? undefined : now,
      };

      const normalizedUserId = normalizeLocalUserId(
        input.userId || input.user_id || existing?.user_id || "1",
      );
      const imageUrl = resolveImageFromWatchlistPayload({
        ...(existing || {}),
        ...input,
        name,
        user_id: normalizedUserId,
      });

      db.prepare(
        `INSERT INTO watchlist_items (
          id, server_id, item_id, user_id, name, type, payload, revision,
          dirty, deleted, created_at, updated_at
        ) VALUES (
          @id, @serverId, @itemId, @userId, @name, @type, @payload, @revision,
          1, 0, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          server_id = COALESCE(@serverId, watchlist_items.server_id),
          item_id = COALESCE(@itemId, watchlist_items.item_id),
          user_id = @userId,
          name = @name,
          type = @type,
          payload = @payload,
          revision = revision + 1,
          dirty = 1,
          deleted = 0,
          updated_at = @updatedAt`,
      ).run({
        id,
        serverId:
          input.serverId ?? input.server_id ??
          (Number.isFinite(Number(input.id)) ? Number(input.id) : null),
        itemId: input.itemId ? String(input.itemId) : null,
        userId: normalizedUserId,
        name,
        type: String(input.type || "skin"),
        payload: serialize({
          ...payload,
          imageUrl: imageUrl || undefined,
        }),
        revision: Number(input.revision || 1),
        createdAt: input.createdAt || existing?.created_at || now,
        updatedAt: now,
      });

      appendOperation("upsert", "watchlist_item", id, {
        ...input,
        id,
        userId: normalizedUserId,
        name,
      });

      const updatedRow = db
        .prepare("SELECT * FROM watchlist_items WHERE id = ? LIMIT 1")
        .get(id);
      return updatedRow ? mapWatchlistItem(updatedRow) : null;
    },

    getWatchlistItem(id) {
      const row = db
        .prepare(
          `SELECT * FROM watchlist_items
           WHERE id = ? AND deleted = 0
           LIMIT 1`,
        )
        .get(String(id));
      return row ? mapWatchlistItem(row) : null;
    },

    deleteWatchlistItem(id) {
      const now = nowIso();
      db.prepare(
        `UPDATE watchlist_items
         SET deleted = 1, dirty = 1, updated_at = ?
         WHERE id = ? AND deleted = 0`,
      ).run(now, String(id));
      appendOperation("delete", "watchlist_item", String(id), {
        id: String(id),
        deletedAt: now,
      });
      return true;
    },

    deleteWatchlistItemSilent(id) {
      db.prepare(
        `UPDATE watchlist_items
         SET deleted = 1, dirty = 1, updated_at = ?
         WHERE id = ? AND deleted = 0`,
      ).run(nowIso(), String(id));
      return true;
    },
  };
}
