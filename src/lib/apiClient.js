const DEFAULT_API_BASE = `${window.location.origin}/api/index.php/api/v1`;
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

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      `API-Fehler (${response.status}) für ${API_BASE}${path}`;
    throw new Error(message);
  }

  return payload?.data;
}

export async function fetchPortfolioInvestments() {
  return request("/***REMOVED***/investments");
}

export async function fetchPortfolioInvestmentHistory(id) {
  return request(`/***REMOVED***/investments/${id}/history`);
}

export async function fetchPortfolioSummary() {
  return request("/***REMOVED***/summary");
}

export async function fetchPortfolioHistory() {
  return request("/***REMOVED***/history");
}

export async function savePortfolioDailyValue(totalValue) {
  return request("/***REMOVED***/daily-value", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalValue }),
  });
}

export async function fetchWatchlist(options = {}) {
  return request(
    buildPath("/watchlist", {
      syncLive: options.syncLive ? 1 : undefined,
    })
  );
}

export async function createWatchlistItem(name, type = "skin") {
  return request("/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type }),
  });
}

export async function deleteWatchlistItem(id) {
  return request(`/watchlist/${id}`, { method: "DELETE" });
}

export async function searchWatchlistItems(query, filters = {}, limit = 6) {
  return request(
    buildPath("/watchlist/search", {
      query,
      itemType: filters.itemType,
      wear: filters.wear,
      limit,
    })
  );
}
