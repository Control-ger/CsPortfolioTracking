import {
  request,
  requestWithMeta,
  resolveCurrentUserQuery,
  buildPath,
} from "./core.js";

export async function fetchWatchlist(options = {}) {
  const userQuery = await resolveCurrentUserQuery(options);
  return requestWithMeta(
    buildPath("/api/v1/watchlist", {
      ...userQuery,
      syncLive: options.syncLive ? 1 : undefined,
    }),
  );
}

export async function fetchCsFloatBuyOrders() {
  // Pagination is fully server-driven: the backend walks all pages via the
  // upstream `count` total, so no limit/maxPages params are sent here.
  return requestWithMeta("/api/v1/csfloat/buy-orders");
}

export async function fetchCsFloatWatchlist(options = {}) {
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(Math.trunc(Number(options.limit)), 40))
    : 40;

  return requestWithMeta(
    buildPath("/api/v1/csfloat/watchlist", {
      limit,
    }),
  );
}

export async function createWatchlistItem(name, type = "skin") {
  const userQuery = await resolveCurrentUserQuery();
  return request("/api/v1/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...userQuery, name, type }),
  });
}

export async function createWatchlistItemsBatch(items = []) {
  const userQuery = await resolveCurrentUserQuery();
  return request("/api/v1/watchlist/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...userQuery, items }),
  });
}

export async function deleteWatchlistItem(id) {
  const userQuery = await resolveCurrentUserQuery();
  return request(buildPath(`/api/v1/watchlist/${id}`, userQuery), { method: "DELETE" });
}

export async function searchWatchlistItems(
  query,
  filters = {},
  limit = 6,
  page = 1,
) {
  const userQuery = await resolveCurrentUserQuery();
  return requestWithMeta(
    buildPath("/api/v1/watchlist/search", {
      ...userQuery,
      query,
      itemType: filters.itemType,
      wear: filters.wear,
      sortBy: filters.sortBy,
      limit,
      page,
    }),
  );
}

export async function fetchWatchlistSearchStats(options = {}) {
  return request(
    buildPath("/api/v1/debug/watchlist-search-stats", {
      hours: Number.isFinite(options.hours) ? options.hours : 24,
      limit: Number.isFinite(options.limit) ? options.limit : 3000,
      top: Number.isFinite(options.top) ? options.top : 10,
    }),
  );
}
