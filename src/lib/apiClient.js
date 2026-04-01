import { errorToContext, sendFrontendTelemetryEvent } from "./frontendTelemetry";

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
  const method = String(options?.method || "GET").toUpperCase();
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch (fetchError) {
    void sendFrontendTelemetryEvent({
      level: "error",
      event: "frontend.fetch_error",
      message: "Fetch request failed",
      context: {
        method,
        path,
        apiBase: API_BASE,
        ...errorToContext(fetchError),
      },
    });
    throw fetchError;
  }

  const contentType = response.headers.get("content-type") || "";
  let payload = null;

  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch (jsonError) {
      void sendFrontendTelemetryEvent({
        level: "error",
        event: "frontend.fetch_error",
        message: "API response JSON parsing failed",
        context: {
          method,
          path,
          statusCode: response.status,
          ...errorToContext(jsonError),
        },
      });
      throw jsonError;
    }
  }

  if (!response.ok) {
    const apiError = buildApiError(path, response, payload);
    void sendFrontendTelemetryEvent({
      level: "error",
      event: "frontend.fetch_error",
      message: "API request returned an error response",
      context: {
        method,
        path,
        statusCode: response.status,
        errorCode: apiError.code || "API_REQUEST_FAILED",
        requestId: response.headers.get("x-request-id") || undefined,
      },
    });
    throw apiError;
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

export async function fetchDebugLogs(options = {}) {
  return request(
    buildPath("/api/v1/debug/logs", {
      type: options.type || "app",
      limit: options.limit || 100,
      event: options.event,
      level: options.level,
      requestId: options.requestId,
    })
  );
}
