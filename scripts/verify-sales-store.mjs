#!/usr/bin/env node

/**
 * Sell-tracking verification.
 *
 * The desktop store is built against better-sqlite3, which is compiled for
 * Electron's ABI and cannot be required from plain node. `node:sqlite` has the
 * same prepare/run/get/all shape, so the real `sales.js` runs against an
 * in-memory database here — the SQL, the FIFO order and the derived holdings
 * are checked without launching (or restarting) the desktop app.
 *
 * Run with `npm run verify:sales`.
 */
import { DatabaseSync } from "node:sqlite";
import { createSalesStore } from "../apps/desktop/src/localStore/sales.js";

// better-sqlite3 shim: node:sqlite has the same prepare/run/get/all shape but
// no transaction() helper.
function adapt(db) {
  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    transaction: (fn) => (...args) => {
      db.exec("BEGIN");
      try { const out = fn(...args); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

const raw = new DatabaseSync(":memory:");
raw.exec(`
  CREATE TABLE investments (
    id TEXT PRIMARY KEY, server_id INTEGER, item_id TEXT, user_id TEXT NOT NULL,
    name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'skin', quantity INTEGER NOT NULL DEFAULT 1,
    buy_price_usd REAL, funding_mode TEXT NOT NULL DEFAULT 'wallet_funded',
    payload TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 1,
    dirty INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE sales (
    id TEXT PRIMARY KEY, server_id INTEGER, item_id TEXT, user_id TEXT NOT NULL,
    name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, sell_price_usd REAL,
    platform TEXT, external_trade_id TEXT, sold_at TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 1,
    dirty INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(server_id));
  CREATE TABLE sale_allocations (
    id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, investment_id TEXT NOT NULL,
    quantity INTEGER NOT NULL, buy_price_usd REAL, created_at TEXT NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE);
  CREATE TABLE operations_log (
    id TEXT PRIMARY KEY, op_type TEXT NOT NULL, entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL, user_id TEXT, payload TEXT NOT NULL DEFAULT '{}',
    idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, applied_at TEXT,
    UNIQUE(idempotency_key));
`);

const U = "steam-76561198340948133";
const buy = (id, qty, price, date) =>
  raw.prepare(`INSERT INTO investments (id,item_id,user_id,name,quantity,buy_price_usd,payload,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)`)
     .run(id, "item-1", U, "Fever Case", qty, price, JSON.stringify({ purchasedAt: date }), date, date);

// Three lots of the same item, deliberately inserted newest-first so the test
// proves the FIFO sort rather than insertion order.
buy("c", 1, 3.00, "2026-03-01T00:00:00Z");
buy("a", 2, 1.00, "2026-01-01T00:00:00Z");
buy("b", 5, 2.00, "2026-02-01T00:00:00Z");

const store = createSalesStore(adapt(raw));
const fail = [];
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); fail.push(label); }
};

// 1. FIFO across lots: 4 units consumes all of "a" (2) then 2 of "b".
const r1 = store.recordSale({ userId: U, itemId: "item-1", name: "Fever Case", quantity: 4, sellPriceUsd: 5, soldAt: "2026-04-01T00:00:00Z", platform: "csfloat", externalTradeId: "T1" });
check("sale allocates fully", [r1.allocated, r1.unallocated], [4, 0]);
const alloc1 = store.listSaleAllocations(r1.sale.id)
  .map((a) => [a.investmentId, a.quantity, a.buyPriceUsd])
  .sort();
check("FIFO order: oldest lot first", alloc1, [["a", 2, 1], ["b", 2, 2]]);

// 2. Derived holdings, not rewritten purchase rows.
check("consumed per row", store.listConsumedQuantities(U).map((r) => [r.investmentId, Number(r.consumedQuantity)]).sort(), [["a", 2], ["b", 2]]);
check("purchase rows untouched", raw.prepare("SELECT id,quantity FROM investments ORDER BY id").all().map((r) => [r.id, r.quantity]), [["a",2],["b",5],["c",1]]);

// 3. Duplicate import of the same trade is a no-op.
const r2 = store.recordSale({ userId: U, itemId: "item-1", name: "Fever Case", quantity: 4, sellPriceUsd: 5, soldAt: "2026-04-01T00:00:00Z", platform: "csfloat", externalTradeId: "T1" });
check("duplicate trade ignored", [r2.duplicate, store.listSales(U).length], [true, 1]);

// 4. Over-selling records the sale and reports the gap instead of refusing.
const r3 = store.recordSale({ userId: U, itemId: "item-1", name: "Fever Case", quantity: 10, sellPriceUsd: 6, soldAt: "2026-05-01T00:00:00Z", platform: "steam" });
check("over-sale reports the gap", [r3.allocated, r3.unallocated], [4, 6]);

// 5. Deleting a sale releases what it consumed.
store.deleteSale(r3.sale.id, U);
check("delete frees allocations", store.listConsumedQuantities(U).map((r) => [r.investmentId, Number(r.consumedQuantity)]).sort(), [["a", 2], ["b", 2]]);

// 6. operations_log carries every mutation for the sync push.
// 6. Every mutation reaches the push queue, deletes included — a tombstone has
//    to travel or the other device keeps a sale this one removed.
check("mutations queue push ops", raw.prepare("SELECT op_type FROM operations_log WHERE entity_type = 'sale' ORDER BY rowid").all().map((r) => r.op_type), ["upsert", "upsert", "delete"]);
//    Two rows: the live sale, plus the deleted one — a tombstone has to reach
//    the server too, so the backfill must not filter deleted rows out.
check("dirty covers live rows and tombstones", store.listDirtySales(U).length, 2);

// 7. Allocations travel in the payload, so a pulling device reproduces the
//    originating device's split instead of re-deriving it.
const payloadOf = (id) => JSON.parse(raw.prepare("SELECT payload FROM sales WHERE id = ?").get(id).payload);
check("payload carries the allocations", payloadOf(r1.sale.id).allocations.map((a) => [a.investmentId, a.quantity]).sort(), [["a", 2], ["b", 2]]);

// 8. Sync is on now, so a mutation queues an operation for the push.
check("recordSale queues a push op", raw.prepare("SELECT COUNT(*) AS n FROM operations_log WHERE entity_type = 'sale'").get().n > 0, true);

// 9. The pull path applies a sale verbatim, allocations included, and must not
//    re-log an operation — otherwise every pull would push the same row back.
const opsBeforePull = raw.prepare("SELECT COUNT(*) AS n FROM operations_log").get().n;
store.importSales([{
  id: "pulled-1", name: "Fever Case", itemId: "item-1", quantity: 1,
  sellPriceUsd: 9, soldAt: "2026-06-01T00:00:00Z", platform: "steam", revision: 3,
  allocations: [{ investmentId: "c", quantity: 1, buyPriceUsd: 3 }],
}], U);
check("pull applies the allocation verbatim", store.listSaleAllocations("pulled-1").map((a) => [a.investmentId, a.quantity, a.buyPriceUsd]), [["c", 1, 3]]);
check("pull logs no operation", raw.prepare("SELECT COUNT(*) AS n FROM operations_log").get().n, opsBeforePull);
check("pulled row is not dirty", store.getSale("pulled-1").dirty, false);

// 10. The backfill enqueues only rows that never reached the server, and only once.
raw.prepare("DELETE FROM operations_log").run();
const first = store.enqueueDirtySaleOperations(U).enqueued;
const second = store.enqueueDirtySaleOperations(U).enqueued;
check("backfill enqueues dirty rows once", [first > 0, second], [true, 0]);
check("backfill skips the pulled row", raw.prepare("SELECT COUNT(*) AS n FROM operations_log WHERE entity_id = 'pulled-1'").get().n, 0);

// 11. The importer contract: the shape `mapCsFloatPreviewTradeToSale` emits has
//     to be exactly what `recordSale` consumes. core.js cannot be imported here
//     (it reads `window` and `import.meta.env` at module scope), so the shape is
//     mirrored — keep the two in step when either changes.
const importerShaped = {
  id: "csfloat-sale-T99",
  name: "Fever Case",
  marketHashName: "Fever Case",
  quantity: 1,
  sellPriceUsd: 7.5,
  soldAt: "2026-07-01T00:00:00Z",
  platform: "csfloat",
  externalTradeId: "T99",
  imageUrl: null,
  floatValue: null,
  paintSeed: null,
  itemId: "item-1",
  userId: U,
};
const imported = store.recordSale(importerShaped);
check("importer shape records a sale", [imported.sale.name, imported.sale.sellPriceUsd, imported.sale.platform], ["Fever Case", 7.5, "csfloat"]);
check("importer re-run deduplicates", store.recordSale(importerShaped).duplicate, true);

console.log(fail.length ? `\n${fail.length} FAILING: ${fail.join(", ")}` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
