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
 * Off until the server understands the entity. `desktopSync.mapOperationToSyncChange`
 * maps only `investment` and `watchlist_item`; anything else is **retired** — marked
 * applied and discarded — so that a block of unmappable ops cannot occupy the
 * oldest-first push window. Queuing sales now would therefore throw them away
 * silently, and the server would never learn about sales recorded in the meantime.
 *
 * Nothing is lost while this is off: `sales.dirty` is the durable "not yet pushed"
 * marker. Turning this on is one half of the server-side slice; the other half is a
 * one-off backfill that enqueues an op for every row still marked dirty.
 */
export const SALE_SYNC_ENABLED = false;

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

        if (SALE_SYNC_ENABLED) {
          appendOperationToLog(db, "upsert", "sale", id, { ...payload, userId, quantity, soldAt }, userId);
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
