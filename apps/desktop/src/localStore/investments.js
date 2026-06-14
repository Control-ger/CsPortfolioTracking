import { randomUUID } from "crypto";
import {
  nowIso,
  serialize,
  deserialize,
  normalizeLocalUserId,
  normalizeBucket,
  toBooleanFlag,
  normalizeOverpayFloor,
} from "./utils.js";

export function mapInvestment(row) {
  const payload = deserialize(row.payload);
  const platform = String(payload?.platform || payload?.source || "").toLowerCase();
  const derivedBucket =
    platform === "steam_inventory"
      ? "inventory"
      : platform === "csfloat"
        ? "investment"
        : "investment";
  const bucket = normalizeBucket(payload?.bucket, derivedBucket);
  const excludedFlag = toBooleanFlag(payload?.excluded ?? payload?.isExcluded);
  const overpayEnabled = toBooleanFlag(
    payload?.overpayEnabled ?? payload?.isOverpayCandidate ?? payload?.floatOverpayWorthy,
  );
  const overpayFloorEur = normalizeOverpayFloor(
    payload?.overpayFloorEur ?? payload?.floatOverpayFloorEur,
  );
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
    overpayEnabled,
    isOverpayCandidate: overpayEnabled,
    overpayFloorEur,
    overpayNote: String(payload?.overpayNote || "").trim() || null,
    revision: row.revision,
    dirty: Boolean(row.dirty),
    deleted: Boolean(row.deleted),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createImportInvestmentRowsTransaction(db) {
  return db.transaction((rows, userId) => {
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
        revision = excluded.revision,
        dirty = CASE WHEN investments.dirty = 1 THEN investments.dirty ELSE 0 END,
        deleted = 0,
        updated_at = excluded.updated_at`,
    );
    // server_id is the server's investments.id (unique, AUTO_INCREMENT, never reused),
    // so two local rows sharing a server_id are always the same logical investment.
    // The upsert only reconciles ON CONFLICT(id); without releasing the server_id from
    // any other local id first, the INSERT would violate UNIQUE(server_id) and abort
    // the whole pull. Must be a hard DELETE — a tombstoned row still occupies its
    // server_id in the unique index. (Mirrors watchlist import.)
    const releaseServerId = db.prepare(
      "DELETE FROM investments WHERE server_id = ? AND id != ?",
    );

    rows.forEach((row) => {
      const id = String(row.id || randomUUID());
      const serverId =
        row.serverId ?? (Number.isFinite(Number(row.id)) ? Number(row.id) : null);
      if (serverId !== null && serverId !== undefined) {
        releaseServerId.run(serverId, id);
      }
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
        userId: normalizeLocalUserId(row.userId || userId),
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
}

export function createInvestmentStore(db) {
  const importInvestmentRows = createImportInvestmentRowsTransaction(db);

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

  return {
    importInvestmentRows,

    listInvestments(userId = "1") {
      return db
        .prepare(
          `SELECT * FROM investments
           WHERE user_id = ? AND deleted = 0
           ORDER BY updated_at DESC`,
        )
        .all(normalizeLocalUserId(userId))
        .map(mapInvestment);
    },

    importInvestments(rows = [], userId = "1") {
      if (!Array.isArray(rows) || rows.length === 0) {
        return { imported: 0 };
      }
      importInvestmentRows(rows, userId);
      return { imported: rows.length };
    },

    upsertInvestment(input = {}) {
      const now = nowIso();
      const id = String(input.id || randomUUID());
      const existing = db
        .prepare(
          `SELECT * FROM investments WHERE id = ? AND deleted = 0 LIMIT 1`,
        )
        .get(id);

      const name = String(
        input.name || input.marketHashName || input.itemName || existing?.name || "",
      );
      const imageUrl =
        input.imageUrl ||
        input.image_url ||
        input.iconUrl ||
        input.icon_url ||
        null;

      const payload = {
        ...(existing?.payload ? deserialize(existing.payload) : {}),
        ...input,
        id,
        name,
        imageUrl,
        platform: input.platform || input.source || undefined,
        bucket:
          input.bucket ||
          input.importBucket ||
          undefined,
        importedAt: existing?.payload
          ? undefined
          : now,
      };

      const normalizedUserId = normalizeLocalUserId(
        input.userId || input.user_id || existing?.user_id || "1",
      );

      db.prepare(
        `INSERT INTO investments (
          id, server_id, item_id, user_id, name, type, quantity, buy_price_usd,
          funding_mode, payload, revision, dirty, deleted, created_at, updated_at
        ) VALUES (
          @id, @serverId, @itemId, @userId, @name, @type, @quantity, @buyPriceUsd,
          @fundingMode, @payload, @revision, 1, 0, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          server_id = COALESCE(@serverId, investments.server_id),
          item_id = COALESCE(@itemId, investments.item_id),
          user_id = @userId,
          name = @name,
          type = @type,
          quantity = @quantity,
          buy_price_usd = @buyPriceUsd,
          funding_mode = @fundingMode,
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
        quantity: input.quantity || 1,
        buyPriceUsd:
          input.buyPriceUsd === undefined
            ? input.buyPrice ?? null
            : Number(input.buyPriceUsd),
        fundingMode: String(input.fundingMode || "wallet_funded"),
        payload: serialize(payload),
        revision: Number(input.revision || 1),
        createdAt: input.createdAt || existing?.created_at || now,
        updatedAt: now,
      });

      appendOperation("upsert", "investment", id, {
        ...input,
        id,
        userId: normalizedUserId,
        name,
      });

      const updatedRow = db
        .prepare("SELECT * FROM investments WHERE id = ? LIMIT 1")
        .get(id);
      return updatedRow ? mapInvestment(updatedRow) : null;
    },

    getInvestment(id) {
      const row = db
        .prepare(
          `SELECT * FROM investments
           WHERE id = ? AND deleted = 0
           LIMIT 1`,
        )
        .get(String(id));
      return row ? mapInvestment(row) : null;
    },

    deleteInvestment(id) {
      const now = nowIso();
      db.prepare(
        `UPDATE investments
         SET deleted = 1, dirty = 1, updated_at = ?
         WHERE id = ? AND deleted = 0`,
      ).run(now, String(id));
      appendOperation("delete", "investment", String(id), {
        id: String(id),
        deletedAt: now,
      });
      return true;
    },

    deleteInvestmentSilent(id) {
      db.prepare(
        `UPDATE investments
         SET deleted = 1, dirty = 1, updated_at = ?
         WHERE id = ? AND deleted = 0`,
      ).run(nowIso(), String(id));
      return true;
    },
  };
}
