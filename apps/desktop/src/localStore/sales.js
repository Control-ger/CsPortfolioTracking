import { randomUUID } from "crypto";
import {
  nowIso,
  serialize,
  deserialize,
  normalizeLocalUserId,
  appendOperation as appendOperationToLog,
} from "./utils.js";

/**
 * Whether a sale mutation is queued for the sync push.
 *
 * On since the server carries the entity: `SyncService::ALLOWED_TABLES` accepts
 * `sales` and `SyncEntityService::applySaleChange` projects it into the domain
 * tables. `desktopSync.mapOperationToSyncChange` maps `sale` → `sales`.
 *
 * It was off while only the local half existed, because `mapOperationToSyncChange`
 * **retires** — marks applied and discards — any entity type it cannot map, so
 * queueing sales then would have destroyed them silently. Rows recorded in that
 * window carry `dirty = 1` and no operation; `enqueueDirtySaleOperations` picks
 * them up once, so nothing written before the server side landed is stranded.
 */
export const SALE_SYNC_ENABLED = true;

/**
 * Sell tracking — local write path.
 *
 * A sale consumes purchase rows through `sale_allocations` and never rewrites
 * them. That keeps purchase rows immutable for sync (a re-priced lot must not
 * silently restate a realised gain) and makes the remaining holding a derived
 * figure: `investments.quantity` minus what allocations consumed.
 *
 * Allocation is FIFO over the oldest unsold rows. The schema is already
 * lot-level — a Steam sync writes one row per physical item, each with its own
 * buy price and purchase date — so FIFO is a sort and a walk rather than a
 * split. See docs/wallet-cost-basis-plan.md §4.
 */
export function createSalesStore(db, deps = {}) {
  const { resolveInvestmentPurchaseDate } = deps;

  function mapSale(row) {
    if (!row) {
      return null;
    }
    const payload = deserialize(row.payload);
    return {
      ...payload,
      id: row.id,
      serverId: row.server_id,
      itemId: row.item_id,
      userId: row.user_id,
      name: row.name,
      quantity: row.quantity,
      sellPriceUsd: row.sell_price_usd,
      platform: row.platform,
      externalTradeId: row.external_trade_id,
      soldAt: row.sold_at,
      revision: row.revision,
      dirty: Boolean(row.dirty),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Purchase date of a row, from the payload the importers write. */
  function purchaseDateOf(investmentRow) {
    if (typeof resolveInvestmentPurchaseDate === "function") {
      return resolveInvestmentPurchaseDate(investmentRow);
    }
    const payload = deserialize(investmentRow.payload);
    const raw = payload?.purchasedAt || payload?.purchased_at || investmentRow.created_at;
    const parsed = Date.parse(String(raw || ""));
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }

  /**
   * How much of a purchase row is still held: its quantity minus everything
   * allocations have already consumed. Sales of a deleted sale do not count —
   * the CASCADE removes their allocations with them.
   */
  function remainingQuantity(investmentId) {
    const row = db
      .prepare("SELECT quantity FROM investments WHERE id = ? AND deleted = 0 LIMIT 1")
      .get(investmentId);
    if (!row) {
      return 0;
    }
    const consumed = db
      .prepare(
        `SELECT COALESCE(SUM(a.quantity), 0) AS consumed
           FROM sale_allocations a
           JOIN sales s ON s.id = a.sale_id
          WHERE a.investment_id = ? AND s.deleted = 0`,
      )
      .get(investmentId);
    return Math.max(0, Number(row.quantity || 0) - Number(consumed?.consumed || 0));
  }

  /**
   * FIFO candidates for an item: purchase rows of that item that still hold
   * something, oldest acquisition first.
   */
  function fifoCandidates(userId, itemId, name) {
    // Match on item_id where the catalogue gave us one, else on the name the
    // importer wrote — a manual sale for a Steam item may have no item_id.
    const rows = itemId
      ? db
          .prepare(
            "SELECT * FROM investments WHERE user_id = ? AND deleted = 0 AND item_id = ?",
          )
          .all(userId, String(itemId))
      : db
          .prepare("SELECT * FROM investments WHERE user_id = ? AND deleted = 0 AND name = ?")
          .all(userId, String(name));

    return rows
      .map((row) => ({ row, remaining: remainingQuantity(row.id), date: purchaseDateOf(row) }))
      .filter((entry) => entry.remaining > 0)
      .sort((left, right) => left.date - right.date);
  }

  return {
    /**
     * Record a sale and allocate it FIFO against held purchase rows.
     *
     * Returns the sale plus what it could and could not allocate. An
     * under-allocated sale is still recorded: a user may sell an item the
     * portfolio never captured, and refusing the write would lose the proceeds
     * — which the wallet factor needs — over a bookkeeping gap.
     */
    recordSale(input = {}) {
      const now = nowIso();
      const id = String(input.id || randomUUID());
      const userId = normalizeLocalUserId(input.userId || input.user_id || "1");
      const name = String(input.name || input.marketHashName || "").trim();
      const quantity = Math.max(1, Number(input.quantity || 1));
      const itemId = input.itemId ? String(input.itemId) : null;
      const soldAt = String(input.soldAt || input.sold_at || now);
      const platform = String(input.platform || input.source || "manual").toLowerCase();
      const externalTradeId = input.externalTradeId
        ? String(input.externalTradeId)
        : null;

      if (!name && !itemId) {
        throw new Error("A sale needs either an itemId or a name.");
      }

      // Importers re-read the same pages, so the same trade must not land twice.
      if (externalTradeId) {
        const duplicate = db
          .prepare(
            `SELECT id FROM sales
              WHERE user_id = ? AND platform = ? AND external_trade_id = ? AND deleted = 0
              LIMIT 1`,
          )
          .get(userId, platform, externalTradeId);
        if (duplicate) {
          return { sale: mapSale(db.prepare("SELECT * FROM sales WHERE id = ?").get(duplicate.id)), duplicate: true, allocated: 0, unallocated: 0 };
        }
      }

      const payload = {
        ...input,
        id,
        name,
        platform,
      };

      const write = db.transaction(() => {
        db.prepare(
          `INSERT INTO sales (
            id, server_id, item_id, user_id, name, quantity, sell_price_usd,
            platform, external_trade_id, sold_at, payload, revision, dirty,
            deleted, created_at, updated_at
          ) VALUES (
            @id, @serverId, @itemId, @userId, @name, @quantity, @sellPriceUsd,
            @platform, @externalTradeId, @soldAt, @payload, @revision, 1,
            0, @createdAt, @updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            server_id = COALESCE(@serverId, sales.server_id),
            item_id = COALESCE(@itemId, sales.item_id),
            user_id = @userId,
            name = @name,
            quantity = @quantity,
            sell_price_usd = @sellPriceUsd,
            platform = @platform,
            external_trade_id = @externalTradeId,
            sold_at = @soldAt,
            payload = @payload,
            revision = revision + 1,
            dirty = 1,
            deleted = 0,
            updated_at = @updatedAt`,
        ).run({
          id,
          serverId: input.serverId ?? input.server_id ?? null,
          itemId,
          userId,
          name,
          quantity,
          sellPriceUsd:
            input.sellPriceUsd === undefined
              ? (input.sellPrice ?? null)
              : Number(input.sellPriceUsd),
          platform,
          externalTradeId,
          soldAt,
          payload: serialize(payload),
          revision: Number(input.revision || 1),
          createdAt: input.createdAt || now,
          updatedAt: now,
        });

        // Re-allocating an updated sale must not double-consume.
        db.prepare("DELETE FROM sale_allocations WHERE sale_id = ?").run(id);

        let outstanding = quantity;
        for (const candidate of fifoCandidates(userId, itemId, name)) {
          if (outstanding <= 0) {
            break;
          }
          const take = Math.min(outstanding, candidate.remaining);
          db.prepare(
            `INSERT INTO sale_allocations
               (id, sale_id, investment_id, quantity, buy_price_usd, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(),
            id,
            candidate.row.id,
            take,
            candidate.row.buy_price_usd ?? null,
            now,
          );
          outstanding -= take;
        }

        // Allocations travel with the sale. Re-running FIFO on the pulling
        // device would have to reproduce this exact split from the same rows in
        // the same order; carrying it makes both devices agree on realised P&L
        // by construction instead of by coincidence.
        const allocations = db
          .prepare(
            `SELECT investment_id AS investmentId, quantity, buy_price_usd AS buyPriceUsd
               FROM sale_allocations WHERE sale_id = ?`,
          )
          .all(id);
        db.prepare("UPDATE sales SET payload = ? WHERE id = ?").run(
          serialize({ ...payload, allocations, unallocatedQuantity: outstanding }),
          id,
        );

        if (SALE_SYNC_ENABLED) {
          appendOperationToLog(db, "upsert", "sale", id, { ...payload, userId, quantity, soldAt, allocations, unallocatedQuantity: outstanding }, userId);
        }
        return outstanding;
      });

      const unallocated = write();
      return {
        sale: mapSale(db.prepare("SELECT * FROM sales WHERE id = ? LIMIT 1").get(id)),
        duplicate: false,
        allocated: quantity - unallocated,
        unallocated,
      };
    },

    listSales(userId = "1") {
      const scope = normalizeLocalUserId(userId);
      return db
        .prepare(
          "SELECT * FROM sales WHERE user_id = ? AND deleted = 0 ORDER BY sold_at DESC",
        )
        .all(scope)
        .map(mapSale);
    },

    /** Allocations of one sale, with the lot cost each consumed row carried. */
    listSaleAllocations(saleId) {
      return db
        .prepare(
          `SELECT a.id, a.sale_id AS saleId, a.investment_id AS investmentId,
                  a.quantity, a.buy_price_usd AS buyPriceUsd, a.created_at AS createdAt
             FROM sale_allocations a
            WHERE a.sale_id = ?`,
        )
        .all(String(saleId));
    },

    /**
     * Remaining held quantity per purchase row, for every row a sale has
     * touched. Callers subtract this from the raw quantity; rows no sale
     * touched are unaffected and are deliberately absent.
     */
    listConsumedQuantities(userId = "1") {
      const scope = normalizeLocalUserId(userId);
      return db
        .prepare(
          `SELECT a.investment_id AS investmentId,
                  SUM(a.quantity) AS consumedQuantity
             FROM sale_allocations a
             JOIN sales s ON s.id = a.sale_id
            WHERE s.user_id = ? AND s.deleted = 0
            GROUP BY a.investment_id`,
        )
        .all(scope);
    },

    getSale(id) {
      return mapSale(db.prepare("SELECT * FROM sales WHERE id = ? LIMIT 1").get(String(id)));
    },

    /**
     * Apply pulled sales. Silent by design: the pull must not re-log operations
     * it just received, or every pull would push the same rows straight back.
     *
     * Allocations come from the payload rather than being re-derived — see
     * `recordSale`. A pulled sale therefore reproduces the originating device's
     * split exactly, including one it could not fully allocate.
     */
    importSales(rows = [], userId = "1") {
      const scope = normalizeLocalUserId(userId);
      const now = nowIso();
      const list = Array.isArray(rows) ? rows : [];
      const write = db.transaction(() => {
        let imported = 0;
        for (const row of list) {
          const id = String(row?.id || "").trim();
          if (!id) {
            continue;
          }
          db.prepare(
            `INSERT INTO sales (
              id, server_id, item_id, user_id, name, quantity, sell_price_usd,
              platform, external_trade_id, sold_at, payload, revision, dirty,
              deleted, created_at, updated_at
            ) VALUES (
              @id, @serverId, @itemId, @userId, @name, @quantity, @sellPriceUsd,
              @platform, @externalTradeId, @soldAt, @payload, @revision, 0,
              0, @createdAt, @updatedAt
            )
            ON CONFLICT(id) DO UPDATE SET
              server_id = COALESCE(@serverId, sales.server_id),
              item_id = COALESCE(@itemId, sales.item_id),
              name = @name,
              quantity = @quantity,
              sell_price_usd = @sellPriceUsd,
              platform = @platform,
              external_trade_id = @externalTradeId,
              sold_at = @soldAt,
              payload = @payload,
              revision = @revision,
              dirty = 0,
              deleted = 0,
              updated_at = @updatedAt`,
          ).run({
            id,
            serverId: row?.serverId ?? row?.server_id ?? null,
            itemId: row?.itemId ? String(row.itemId) : null,
            userId: scope,
            name: String(row?.name || ""),
            quantity: Math.max(1, Number(row?.quantity || 1)),
            sellPriceUsd:
              row?.sellPriceUsd === undefined
                ? (row?.sellPrice ?? null)
                : Number(row.sellPriceUsd),
            platform: String(row?.platform || "manual").toLowerCase(),
            externalTradeId: row?.externalTradeId ? String(row.externalTradeId) : null,
            soldAt: String(row?.soldAt || row?.sold_at || now),
            payload: serialize(row || {}),
            revision: Number(row?.revision || 1),
            createdAt: row?.createdAt || now,
            updatedAt: row?.updatedAt || now,
          });

          db.prepare("DELETE FROM sale_allocations WHERE sale_id = ?").run(id);
          const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
          for (const allocation of allocations) {
            const investmentId = String(allocation?.investmentId || "").trim();
            const quantity = Number(allocation?.quantity || 0);
            if (!investmentId || !(quantity > 0)) {
              continue;
            }
            db.prepare(
              `INSERT INTO sale_allocations
                 (id, sale_id, investment_id, quantity, buy_price_usd, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            ).run(
              randomUUID(),
              id,
              investmentId,
              quantity,
              allocation?.buyPriceUsd ?? null,
              now,
            );
          }
          imported += 1;
        }
        return imported;
      });
      return { imported: write() };
    },

    /** Delete without logging an operation — for the pull path. */
    deleteSaleSilent(id) {
      db.prepare(
        "UPDATE sales SET deleted = 1, dirty = 0, updated_at = ? WHERE id = ?",
      ).run(nowIso(), String(id));
      return { id: String(id) };
    },

    /**
     * Enqueue a push operation for every sale that never reached the server.
     * Runs once when sale sync is switched on: rows recorded while it was off
     * carry `dirty = 1` and no operation, so without this they would stay on the
     * device forever.
     */
    enqueueDirtySaleOperations(userId = "1") {
      if (!SALE_SYNC_ENABLED) {
        return { enqueued: 0 };
      }
      const scope = normalizeLocalUserId(userId);
      const rows = db
        .prepare("SELECT * FROM sales WHERE user_id = ? AND dirty = 1 ORDER BY sold_at")
        .all(scope);
      const write = db.transaction(() => {
        let enqueued = 0;
        for (const row of rows) {
          const pending = db
            .prepare(
              `SELECT 1 FROM operations_log
                WHERE entity_type = 'sale' AND entity_id = ? AND applied_at IS NULL
                LIMIT 1`,
            )
            .get(row.id);
          if (pending) {
            continue;
          }
          const sale = mapSale(row);
          appendOperationToLog(
            db,
            row.deleted ? "delete" : "upsert",
            "sale",
            row.id,
            { ...sale, userId: scope },
            scope,
          );
          enqueued += 1;
        }
        return enqueued;
      });
      return { enqueued: write() };
    },

    /** Sales not yet pushed — the backfill's input once sale sync is enabled. */
    listDirtySales(userId = "1") {
      const scope = normalizeLocalUserId(userId);
      return db
        .prepare("SELECT * FROM sales WHERE user_id = ? AND dirty = 1 ORDER BY sold_at")
        .all(scope)
        .map(mapSale);
    },

    deleteSale(id, userId = "1") {
      const scope = normalizeLocalUserId(userId);
      const now = nowIso();
      const remove = db.transaction(() => {
        db.prepare(
          "UPDATE sales SET deleted = 1, dirty = 1, revision = revision + 1, updated_at = ? WHERE id = ?",
        ).run(now, String(id));
        if (SALE_SYNC_ENABLED) {
          appendOperationToLog(db, "delete", "sale", String(id), { id: String(id), userId: scope }, scope);
        }
      });
      remove();
      return { id: String(id) };
    },
  };
}
