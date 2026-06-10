import { randomUUID } from "crypto";
import {
  nowIso,
  normalizeLocalUserId,
  serialize,
  deserialize,
  CANONICAL_LOCAL_USER_ID,
} from "./utils.js";

export function mapPortfolioSnapshot(row) {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.captured_at,
    wert: row.total_value_usd,
    investedValue: row.invested_value_usd,
    payload: deserialize(row.payload, {}),
    capturedAt: row.captured_at,
  };
}

export function createSnapshotStore(db) {
  return {
    listPortfolioSnapshots(
      userId = CANONICAL_LOCAL_USER_ID,
      limit = 365,
    ) {
      const normalizedUserId = normalizeLocalUserId(userId);
      return db
        .prepare(
          `SELECT * FROM portfolio_snapshots
           WHERE user_id = ?
           ORDER BY captured_at ASC
           LIMIT ?`,
        )
        .all(normalizedUserId, Math.max(1, Math.min(Number(limit), 3650)))
        .map(mapPortfolioSnapshot);
    },

    upsertPortfolioSnapshot(input = {}) {
      const now = nowIso();
      const capturedAt = input.capturedAt || input.captured_at || now;
      const normalizedUserId = normalizeLocalUserId(
        input.userId || input.user_id || CANONICAL_LOCAL_USER_ID,
      );
      const totalValueUsd = Number(
        input.totalValueUsd ?? input.total_value_usd ?? input.wert ?? 0,
      );
      const investedValueUsd = Number(
        input.investedValueUsd ?? input.invested_value_usd ?? input.investedValue ?? 0,
      );

      const id = String(input.id || randomUUID());
      const payload = serialize({
        ...(input.payload || {}),
      });

      db.prepare(
        `INSERT INTO portfolio_snapshots
          (id, user_id, captured_at, total_value_usd, invested_value_usd, payload)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, captured_at) DO UPDATE SET
          total_value_usd = excluded.total_value_usd,
          invested_value_usd = excluded.invested_value_usd,
          payload = excluded.payload`,
      ).run(id, normalizedUserId, capturedAt, totalValueUsd, investedValueUsd, payload);

      const row = db
        .prepare(
          `SELECT * FROM portfolio_snapshots
           WHERE user_id = ? AND captured_at = ?
           LIMIT 1`,
        )
        .get(normalizedUserId, capturedAt);
      return row ? mapPortfolioSnapshot(row) : null;
    },
  };
}
