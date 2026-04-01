const DEFAULT_API_BASE = `${window.location.origin}/api/index.php`;
const API_BASE = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE;

function buildPath(path, query = {}) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    params.set(key, String(value));
  });

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function buildApiError(path, response, payload) {
  const message =
    payload?.error?.message ||
    `API-Fehler (${response.status}) fuer ${API_BASE}${path}`;
  const error = new Error(message);
  error.status = response.status;
  error.code = payload?.error?.code || "API_REQUEST_FAILED";
  error.details = payload?.error?.details || {};
  return error;
}

async function requestPayload(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    throw buildApiError(path, response, payload);
  }

  return payload || { data: null, meta: {} };
}

async function request(path, options = {}) {
  const payload = await requestPayload(path, options);
  return payload?.data;
}

async function requestWithMeta(path, options = {}) {
  const payload = await requestPayload(path, options);
  return {
    data: payload?.data,
    meta: payload?.meta || {},
  };
}

export async function fetchPortfolioInvestments() {
  return requestWithMeta("/api/v1/***REMOVED***/investments");
}

export async function fetchPortfolioInvestmentHistory(id) {
  return request(`/api/v1/***REMOVED***/investments/${id}/history`);
}

export async function fetchPortfolioSummary() {
  return requestWithMeta("/api/v1/***REMOVED***/summary");
}

export async function fetchPortfolioHistory() {
  return request("/api/v1/***REMOVED***/history");
}

export async function fetchPortfolioComposition() {
  return request("/api/v1/***REMOVED***/composition");
}

export async function savePortfolioDailyValue(totalValue) {
  return request("/api/v1/***REMOVED***/daily-value", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalValue }),
  });
}

export async function fetchWatchlist(options = {}) {
  return requestWithMeta(
    buildPath("/api/v1/watchlist", {
      syncLive: options.syncLive ? 1 : undefined,
    })
  );
}

export async function createWatchlistItem(name, type = "skin") {
  return request("/api/v1/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type }),
  });
}

export async function deleteWatchlistItem(id) {
  return request(`/api/v1/watchlist/${id}`, { method: "DELETE" });
}

export async function searchWatchlistItems(
  query,
  filters = {},
  limit = 6,
  page = 1
) {
  return requestWithMeta(
    buildPath("/api/v1/watchlist/search", {
      query,
      itemType: filters.itemType,
      wear: filters.wear,
      sortBy: filters.sortBy,
      limit,
      page,
    })
  );
}
