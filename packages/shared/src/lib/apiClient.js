// Domain-split API client — re-exports from domain-specific files.
// This file serves as a barrel for backward compatibility with existing
// imports (e.g. `import { ... } from "@shared/lib/apiClient"` or
// `import { ... } from "@shared/lib"`).
//
// Domain files:
//   api/investments.js  — Portfolio CRUD, overpay, bucket, exclude
//   api/watchlist.js    — Watchlist CRUD, search, buy orders
//   api/settings.js     — Fees, currency, price source, API keys, web push
//   api/sync.js         — CSFloat + SkinBaron trade sync (desktop & server)
//   api/auth.js         — Debug logs, cache stats, CS updates feed

export * from "./api/investments.js";
export * from "./api/watchlist.js";
export * from "./api/settings.js";
export * from "./api/sync.js";
export * from "./api/auth.js";
