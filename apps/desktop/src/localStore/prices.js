import { randomUUID } from "crypto";
import { nowIso, serialize } from "./utils.js";

export function createPriceStore(db) {
  return {
    upsertPrice(input = {}) {
      const itemId = String(input.itemId || input.item_id || "");
      if (!itemId) {
        throw new Error("itemId is required for local price upsert");
      }

      const fetchedAt = input.fetchedAt || nowIso();
      const payload = serialize(input);

      db.prepare(
        `INSERT INTO item_prices
          (item_id, price_usd, price_eur, exchange_rate, source, fetched_at, payload)
         VALUES (@itemId, @priceUsd, @priceEur, @exchangeRate, @source, @fetchedAt, @payload)
         ON CONFLICT(item_id) DO UPDATE SET
          price_usd = excluded.price_usd,
          price_eur = excluded.price_eur,
          exchange_rate = excluded.exchange_rate,
          source = excluded.source,
          fetched_at = excluded.fetched_at,
          payload = excluded.payload`,
      ).run({
        itemId,
        priceUsd: input.priceUsd ?? null,
        priceEur: input.priceEur ?? null,
        exchangeRate: input.exchangeRate ?? null,
        source: input.source || null,
        fetchedAt,
        payload,
      });

      db.prepare(
        `INSERT OR IGNORE INTO price_history
          (id, item_id, price_usd, price_eur, exchange_rate, source, captured_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        itemId,
        input.priceUsd ?? null,
        input.priceEur ?? null,
        input.exchangeRate ?? null,
        input.source || null,
        fetchedAt,
        payload,
      );

      return { itemId, fetchedAt };
    },

    listPriceHistory(itemId, limitDays = 370) {
      const resolvedItemId = String(itemId || "");
      if (!resolvedItemId) {
        return [];
      }

      const days = Math.max(1, Number(limitDays || 370));
      const fromTimestamp = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
      ).toISOString();

      return db
        .prepare(
          `SELECT captured_at, price_usd, price_eur, exchange_rate, source
           FROM price_history
           WHERE item_id = ? AND captured_at >= ?
           ORDER BY captured_at ASC`,
        )
        .all(resolvedItemId, fromTimestamp)
        .map((row) => ({
          date: row.captured_at,
          priceUsd: row.price_usd ?? null,
          priceEur: row.price_eur ?? null,
          exchangeRate: row.exchange_rate ?? null,
          source: row.source ?? null,
        }));
    },
  };
}
