import {
  request,
  requestWithMeta,
  buildPath,
} from "./core.js";

export async function fetchDebugLogs(options = {}) {
  return request(
    buildPath("/api/v1/debug/logs", {
      type: options.type || "app",
      limit: options.limit || 100,
      event: options.event,
      level: options.level,
      requestId: options.requestId,
    }),
  );
}

export async function fetchCacheMaintenanceStats() {
  return requestWithMeta("/api/v1/debug/cache/stats");
}

export async function fetchCsUpdatesFeed(options = {}) {
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : undefined;
  const before = typeof options.before === "string" ? options.before : undefined;
  const since = typeof options.since === "string" ? options.since : undefined;

  return requestWithMeta(
    buildPath("/api/v1/cs-updates", {
      limit,
      before,
      since,
    }),
    {
      signal: options.signal,
    },
  );
}
