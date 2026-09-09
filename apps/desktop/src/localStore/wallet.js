import { randomUUID } from "crypto";
import {
  nowIso,
  serialize,
  deserialize,
  normalizeLocalUserId,
  appendOperation as appendOperationToLog,
} from "./utils.js";

/**
 * Whether a wallet-event mutation is queued for the sync push.
 *
 * On since the server carries the entity: `SyncService::ALLOWED_TABLES` accepts
 * `wallet_events` and `applyWalletEventChange` projects it. Rows written while
 * this was off carry `dirty = 1` and no operation, and
 * `enqueueDirtyWalletOperations` picks them up on the next push.
 */
export const WALLET_SYNC_ENABLED = true;

/** Amounts below this are treated as zero — a pure reconciliation entry. */
const AMOUNT_EPSILON = 1e-9;

export function createWalletStore(db) {
  function mapEvent(row) {
    if (!row) {
      return null;
    }
    return {
      ...deserialize(row.payload),
      id: row.id,
      serverId: row.server_id,
      userId: row.user_id,
      platform: row.platform,
      amountUsd: row.amount_usd,
      feeUsd: row.fee_usd,
      balanceAfterUsd: row.balance_after_usd,
      note: row.note,
      occurredAt: row.occurred_at,
      revision: row.revision,
      dirty: Boolean(row.dirty),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    /**
     * Record money entering or leaving a marketplace wallet.
     *
     * One entity for both directions: a deposit is a positive `amountUsd`, a
     * withdrawal a negative one. `balanceAfterUsd` is the user's own reading of
     * the wallet at that moment and is optional; an entry with amount 0 and a
     * balance is a pure reconciliation point.
     */
    recordWalletEvent(input = {}) {
      const now = nowIso();
      const id = String(input.id || randomUUID());
      const userId = normalizeLocalUserId(input.userId || input.user_id || "1");
      const platform = String(input.platform || "manual").trim().toLowerCase();
      const amountUsd = Number(input.amountUsd);
      const balanceAfterUsd =
        input.balanceAfterUsd === undefined || input.balanceAfterUsd === null
          ? null
          : Number(input.balanceAfterUsd);

      if (!Number.isFinite(amountUsd)) {
        throw new Error("A wallet event needs a finite amount.");
      }
      // Amount 0 is meaningful only as a reconciliation point, so it must carry
      // a balance — otherwise the entry says nothing at all.
      if (Math.abs(amountUsd) < AMOUNT_EPSILON && balanceAfterUsd === null) {
        throw new Error("A zero-amount wallet event needs a balance to reconcile against.");
      }

      const payload = { ...input, id, platform };
      const write = db.transaction(() => {
        db.prepare(
          `INSERT INTO wallet_events (
            id, server_id, user_id, platform, amount_usd, fee_usd,
            balance_after_usd, note, occurred_at, payload, revision, dirty,
            deleted, created_at, updated_at
          ) VALUES (
            @id, @serverId, @userId, @platform, @amountUsd, @feeUsd,
            @balanceAfterUsd, @note, @occurredAt, @payload, @revision, 1,
            0, @createdAt, @updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            server_id = COALESCE(@serverId, wallet_events.server_id),
            user_id = @userId,
            platform = @platform,
            amount_usd = @amountUsd,
            fee_usd = @feeUsd,
            balance_after_usd = @balanceAfterUsd,
            note = @note,
            occurred_at = @occurredAt,
            payload = @payload,
            revision = revision + 1,
            dirty = 1,
            deleted = 0,
            updated_at = @updatedAt`,
        ).run({
          id,
          serverId: input.serverId ?? input.server_id ?? null,
          userId,
          platform,
          amountUsd,
          // A withdrawal fee is already taken off the proceeds side
          // (`calculateNetProceeds`); recording it here too would count it
          // twice. Only an acquisition-side fee belongs on the event.
          feeUsd: Math.max(0, Number(input.feeUsd || 0)),
          balanceAfterUsd,
          note: input.note ? String(input.note) : null,
          occurredAt: String(input.occurredAt || now),
          payload: serialize(payload),
          revision: Number(input.revision || 1),
          createdAt: input.createdAt || now,
          updatedAt: now,
        });

        if (WALLET_SYNC_ENABLED) {
          appendOperationToLog(db, "upsert", "wallet_event", id, { ...payload, userId }, userId);
        }
      });
      write();

      return {
        event: mapEvent(db.prepare("SELECT * FROM wallet_events WHERE id = ? LIMIT 1").get(id)),
      };
    },

    listWalletEvents(userId = "1", platform = null) {
      const scope = normalizeLocalUserId(userId);
      const rows = platform
        ? db
            .prepare(
              `SELECT * FROM wallet_events
                WHERE user_id = ? AND deleted = 0 AND platform = ?
                ORDER BY occurred_at, created_at`,
            )
            .all(scope, String(platform).toLowerCase())
        : db
            .prepare(
              `SELECT * FROM wallet_events
                WHERE user_id = ? AND deleted = 0
                ORDER BY occurred_at, created_at`,
            )
            .all(scope);
      return rows.map(mapEvent);
    },

    deleteWalletEvent(id, userId = "1") {
      const scope = normalizeLocalUserId(userId);
      const now = nowIso();
      const remove = db.transaction(() => {
        const result = db
          .prepare(
            `UPDATE wallet_events
                SET deleted = 1, dirty = 1, revision = revision + 1, updated_at = ?
              WHERE id = ? AND user_id = ?`,
          )
          .run(now, String(id), scope);
        if (result.changes === 0) {
          return false;
        }
        if (WALLET_SYNC_ENABLED) {
          appendOperationToLog(db, "delete", "wallet_event", String(id), { id: String(id), userId: scope }, scope);
        }
        return true;
      });
      return { id: String(id), deleted: remove() };
    },

    /**
     * Apply pulled events. Silent: a pull that re-logged what it received would
     * push the same rows straight back.
     */
    importWalletEvents(rows = [], userId = "1") {
      const scope = normalizeLocalUserId(userId);
      const now = nowIso();
      const write = db.transaction(() => {
        let imported = 0;
        for (const row of Array.isArray(rows) ? rows : []) {
          const id = String(row?.id || "").trim();
          if (!id) {
            continue;
          }
          db.prepare(
            `INSERT INTO wallet_events (
              id, server_id, user_id, platform, amount_usd, fee_usd,
              balance_after_usd, note, occurred_at, payload, revision, dirty,
              deleted, created_at, updated_at
            ) VALUES (
              @id, @serverId, @userId, @platform, @amountUsd, @feeUsd,
              @balanceAfterUsd, @note, @occurredAt, @payload, @revision, 0,
              0, @createdAt, @updatedAt
            )
            ON CONFLICT(id) DO UPDATE SET
              server_id = COALESCE(@serverId, wallet_events.server_id),
              platform = @platform,
              amount_usd = @amountUsd,
              fee_usd = @feeUsd,
              balance_after_usd = @balanceAfterUsd,
              note = @note,
              occurred_at = @occurredAt,
              payload = @payload,
              revision = @revision,
              dirty = 0,
              deleted = 0,
              updated_at = @updatedAt`,
          ).run({
            id,
            serverId: row?.serverId ?? null,
            userId: scope,
            platform: String(row?.platform || "manual").toLowerCase(),
            amountUsd: Number(row?.amountUsd || 0),
            feeUsd: Math.max(0, Number(row?.feeUsd || 0)),
            balanceAfterUsd:
              row?.balanceAfterUsd === undefined || row?.balanceAfterUsd === null
                ? null
                : Number(row.balanceAfterUsd),
            note: row?.note ? String(row.note) : null,
            occurredAt: String(row?.occurredAt || now),
            payload: serialize(row || {}),
            revision: Number(row?.revision || 1),
            createdAt: row?.createdAt || now,
            updatedAt: row?.updatedAt || now,
          });
          imported += 1;
        }
        return imported;
      });
      return { imported: write() };
    },

    /** Delete without logging an operation — for the pull path. */
    deleteWalletEventSilent(id) {
      db.prepare(
        "UPDATE wallet_events SET deleted = 1, dirty = 0, updated_at = ? WHERE id = ?",
      ).run(nowIso(), String(id));
      return { id: String(id) };
    },

    /** Clear the pending marker once the server has accepted the event. */
    markWalletEventPushed(id, pushedAt = null) {
      db.prepare(
        "UPDATE wallet_events SET dirty = 0 WHERE id = ? AND dirty = 1 AND updated_at <= ?",
      ).run(String(id), String(pushedAt || nowIso()));
      return { id: String(id) };
    },

    enqueueDirtyWalletOperations(userId = "1") {
      if (!WALLET_SYNC_ENABLED) {
        return { enqueued: 0 };
      }
      const scope = normalizeLocalUserId(userId);
      const rows = db
        .prepare("SELECT * FROM wallet_events WHERE user_id = ? AND dirty = 1 ORDER BY occurred_at")
        .all(scope);
      const write = db.transaction(() => {
        let enqueued = 0;
        for (const row of rows) {
          const pending = db
            .prepare(
              `SELECT 1 FROM operations_log
                WHERE entity_type = 'wallet_event' AND entity_id = ? AND applied_at IS NULL
                LIMIT 1`,
            )
            .get(row.id);
          if (pending) {
            continue;
          }
          appendOperationToLog(
            db,
            row.deleted ? "delete" : "upsert",
            "wallet_event",
            row.id,
            { ...mapEvent(row), userId: scope },
            scope,
          );
          enqueued += 1;
        }
        return enqueued;
      });
      return { enqueued: write() };
    },
  };
}
