import { getSession } from "./auth.js";
import { get as cacheGet, set as cacheSet } from "./localCache.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";

const SYNC_CURSOR_CACHE_KEY = "desktop-sync:last-pull-at";
const SYNC_MIN_INTERVAL_MS = 30_000;
const DEFAULT_PULL_LIMIT = 500;
const AUTO_SYNC_INTERVAL_MS = 60_000;

let lastSyncAtMs = 0;
let inFlightSyncPromise = null;
let autoSyncStarted = false;
let autoSyncIntervalId = null;

function isDesktopWithLocalStore() {
  return (
    typeof window !== "undefined" &&
    window.electronAPI &&
    window.electronAPI.localStore &&
    window.electronAPI.serverConfig
  );
}

function normalizeServerBaseUrl(rawUrl) {
  return String(rawUrl || "").trim().replace(/\/+$/, "");
}

function resolveAccessBaseUrl(serverBaseUrl) {
  const normalized = String(serverBaseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  if (lower.endsWith("/api/index.php")) {
    return normalized.slice(0, -"/api/index.php".length);
  }
  if (lower.endsWith("/api")) {
    return normalized.slice(0, -"/api".length);
  }
  return normalized;
}

async function hasCloudflareAccessIdentity(accessBaseUrl) {
  if (!accessBaseUrl) {
    return true;
  }

  const response = await fetch(`${accessBaseUrl}/cdn-cgi/access/get-identity`, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 404 || response.status === 400) {
    // Access is not active for this host.
    return true;
  }
  if (response.status === 401 || response.status === 403) {
    return false;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/json")) {
    return false;
  }

  const payload = await response.json().catch(() => null);
  return Boolean(payload && typeof payload === "object");
}

function buildSyncEndpointCandidates(serverBaseUrl, endpointPath) {
  const normalizedBase = String(serverBaseUrl || "").trim().replace(/\/+$/, "");
  const endpoint = String(endpointPath || "").startsWith("/")
    ? String(endpointPath)
    : `/${String(endpointPath || "")}`;

  if (!normalizedBase || !endpoint) {
    return [];
  }

  const lower = normalizedBase.toLowerCase();
  const candidates = [];

  if (lower.endsWith("/api/index.php")) {
    candidates.push(`${normalizedBase}${endpoint}`);
    candidates.push(`${normalizedBase.slice(0, -"/api/index.php".length)}${endpoint}`);
  } else if (lower.endsWith("/api")) {
    candidates.push(`${normalizedBase}${endpoint}`);
    candidates.push(`${normalizedBase}/index.php${endpoint}`);
    candidates.push(`${normalizedBase.slice(0, -"/api".length)}${endpoint}`);
  } else {
    candidates.push(`${normalizedBase}${endpoint}`);
    candidates.push(`${normalizedBase}/api/index.php${endpoint}`);
  }

  return Array.from(new Set(candidates));
}

async function fetchSyncEndpointWithFallback(serverBaseUrl, endpointPath, options) {
  const candidates = buildSyncEndpointCandidates(serverBaseUrl, endpointPath);
  if (candidates.length === 0) {
    throw new Error("Sync endpoint URL konnte nicht aufgebaut werden.");
  }

  let lastResponse = null;
  for (const url of candidates) {
    const response = await fetchWithCloudflareAccess(url, options, serverBaseUrl);
    if (response.status === 404) {
      lastResponse = response;
      continue;
    }
    return response;
  }

  return lastResponse;
}

async function ensureCloudflareAccessSession(serverBaseUrl) {
  const accessBaseUrl = resolveAccessBaseUrl(serverBaseUrl);
  if (!accessBaseUrl) {
    return;
  }

  const hasIdentity = await hasCloudflareAccessIdentity(accessBaseUrl).catch(() => false);
  if (hasIdentity) {
    return;
  }

  if (!window.electronAPI?.cloudflareAccess?.login) {
    throw new Error("Cloudflare Access Session fehlt und Login-Fenster ist nicht verfuegbar.");
  }

  const loginResult = await window.electronAPI.cloudflareAccess.login(accessBaseUrl);
  if (!loginResult?.ok) {
    throw new Error(loginResult?.error || "Cloudflare Access Anmeldung fehlgeschlagen.");
  }

  const hasIdentityAfterLogin = await hasCloudflareAccessIdentity(accessBaseUrl).catch(() => true);
  if (!hasIdentityAfterLogin) {
    throw new Error("Cloudflare Access Session konnte nicht bestaetigt werden.");
  }
}

function isCloudflareAccessChallengeResponse(response) {
  const url = String(response?.url || "");
  if (url.includes("/cdn-cgi/access/")) {
    return true;
  }

  const deniedReason = String(response?.headers?.get?.("cf-access-denied-reason") || "").trim();
  if (deniedReason) {
    return true;
  }

  if (response?.status !== 401 && response?.status !== 403) {
    return false;
  }

  const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
  const serverHeader = String(response?.headers?.get?.("server") || "").toLowerCase();
  const challengeHint = String(response?.headers?.get?.("cf-mitigated") || "").toLowerCase();

  if (challengeHint.includes("challenge")) {
    return true;
  }

  // Avoid false positives for normal API auth errors (JSON 401/403).
  return contentType.includes("text/html") && serverHeader.includes("cloudflare");
}

async function fetchWithCloudflareAccess(url, options, serverBaseUrl) {
  await ensureCloudflareAccessSession(serverBaseUrl);

  let response = await fetch(url, {
    ...options,
    credentials: "include",
  });

  if (!isCloudflareAccessChallengeResponse(response)) {
    return response;
  }

  if (!window.electronAPI?.cloudflareAccess?.login) {
    return response;
  }

  const loginResult = await window.electronAPI.cloudflareAccess.login(resolveAccessBaseUrl(serverBaseUrl));
  if (!loginResult?.ok) {
    return response;
  }

  response = await fetch(url, {
    ...options,
    credentials: "include",
  });

  return response;
}

function unwrapApiData(payload) {
  return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

function parseUserId(user) {
  const candidate = user?.id ?? user?.userId ?? 1;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function withSafetyWindow(timestamp) {
  const parsed = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(parsed)) {
    return String(timestamp || "1970-01-01T00:00:00.000Z");
  }
  return new Date(Math.max(0, parsed - 1000)).toISOString();
}

function mapOperationToSyncChange(operation) {
  const entityType = String(operation?.entityType || "").toLowerCase();
  const table =
    entityType === "investment"
      ? "investments"
      : entityType === "watchlist_item"
        ? "watchlist_items"
        : null;
  if (!table) {
    return null;
  }

  return {
    localOperationId: operation.id,
    op: String(operation.opType || "upsert"),
    table,
    id: String(operation.entityId || ""),
    payload:
      operation && typeof operation.payload === "object" && operation.payload !== null
        ? operation.payload
        : {},
    idempotencyKey: String(operation.idempotencyKey || ""),
    clientRevision: Number(operation?.payload?.revision || 0),
  };
}

async function enrichSyncChange(operation, localStore) {
  if (!operation) {
    return null;
  }

  const normalized = { ...operation };
  if (normalized.table !== "investments" || normalized.op !== "upsert") {
    return normalized;
  }

  const payload = normalized.payload && typeof normalized.payload === "object"
    ? { ...normalized.payload }
    : {};
  const hasName = String(payload.name || payload.marketHashName || "").trim().length > 0;

  if (!hasName) {
    try {
      const existing = unwrapLocalStoreResult(
        await localStore.getInvestment(normalized.id),
        "local-store-get-investment",
      );
      if (existing && typeof existing === "object") {
        normalized.payload = {
          ...existing,
          ...payload,
          id: normalized.id,
        };
        return normalized;
      }
    } catch (error) {
      console.warn("[desktop-sync] failed to enrich investment operation", {
        id: normalized.id,
        error: error?.message || String(error),
      });
    }
  }

  normalized.payload = payload;
  return normalized;
}

function shouldDropRejectedOperation(operation, rejected) {
  const errorCode = String(rejected?.errorCode || "");
  const message = String(rejected?.message || "").toLowerCase();

  if (errorCode === "IDEMPOTENCY_KEY_REUSE") {
    return true;
  }

  if (errorCode !== "SYNC_APPLY_FAILED") {
    return false;
  }

  if (message.includes("requires name or markethashname")) {
    return true;
  }
  if (message.includes("duplicate entry")) {
    return true;
  }
  if (message.includes("cannot add or update a child row")) {
    return true;
  }

  // Legacy malformed operations from earlier desktop builds can keep retrying forever.
  if (String(operation?.table || "") === "investments") {
    if (
      message.includes("failed to resolve item for sync payload") ||
      message.includes("incorrect integer value")
    ) {
      return true;
    }
  }

  return false;
}

async function pushPendingOperations(serverBaseUrl, userId, token, localStore) {
  const pending = unwrapLocalStoreResult(
    await localStore.listPendingOperations(200),
    "local-store-list-pending-operations",
  );
  if (!Array.isArray(pending) || pending.length === 0) {
    return;
  }

  const mapped = [];
  for (const operation of pending) {
    const base = mapOperationToSyncChange(operation);
    if (!base) {
      continue;
    }
    const enriched = await enrichSyncChange(base, localStore);
    if (enriched) {
      mapped.push(enriched);
    }
  }
  if (mapped.length === 0) {
    return;
  }

  const response = await fetchSyncEndpointWithFallback(serverBaseUrl, "/api/v1/sync/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      userId,
      changes: mapped.map((operation) => ({
        op: operation.op,
        table: operation.table,
        id: operation.id,
        payload: operation.payload,
        idempotencyKey: operation.idempotencyKey,
        clientRevision: operation.clientRevision,
      })),
    }),
  });

  if (!response || !response.ok) {
    const status = response?.status ?? "unknown";
    const body = response ? await response.text().catch(() => "") : "";
    throw new Error(`Sync push failed with status ${status}${body ? ` response: ${body}` : ""}`);
  }

  const data = unwrapApiData(await response.json());
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) {
    return;
  }

  const keyToResult = new Map(
    results.map((result) => [`${result.table}:${result.id}:${result.status}`, result]),
  );
  for (const op of mapped) {
    const applied = keyToResult.get(`${op.table}:${op.id}:applied`);
    const conflict = keyToResult.get(`${op.table}:${op.id}:conflict`);
    const rejected = keyToResult.get(`${op.table}:${op.id}:rejected`);
    if (rejected) {
      const dropped = shouldDropRejectedOperation(op, rejected);

      if (dropped) {
        unwrapLocalStoreResult(
          await localStore.markOperationApplied(op.localOperationId),
          "local-store-mark-operation-applied",
        );
        continue;
      }
      console.warn("[desktop-sync] operation rejected by server", {
        table: op.table,
        id: op.id,
        result: rejected,
      });
      continue;
    }
    if (applied || conflict) {
      unwrapLocalStoreResult(
        await localStore.markOperationApplied(op.localOperationId),
        "local-store-mark-operation-applied",
      );
    }
  }
}

async function applyPulledChanges(changes, localStore, userId) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return;
  }

  const investmentUpserts = [];
  const watchlistUpserts = [];
  const investmentDeletes = [];
  const watchlistDeletes = [];

  for (const change of changes) {
    const table = String(change?.table || "");
    const op = String(change?.op || "upsert");
    const id = String(change?.id || "");
    if (!id || !table) {
      continue;
    }

    if (op === "delete") {
      if (table === "investments") {
        investmentDeletes.push(id);
      } else if (table === "watchlist_items") {
        watchlistDeletes.push(id);
      }
      continue;
    }

    const payload =
      change && typeof change.payload === "object" && change.payload !== null
        ? change.payload
        : {};
    const normalized = {
      ...payload,
      id,
      userId: payload.userId || userId,
      revision: Number(change.serverRevision || payload.revision || 1),
      updatedAt: change.updatedAt || payload.updatedAt || new Date().toISOString(),
    };

    if (table === "investments") {
      investmentUpserts.push(normalized);
    } else if (table === "watchlist_items") {
      watchlistUpserts.push(normalized);
    }
  }

  if (investmentUpserts.length > 0) {
    unwrapLocalStoreResult(
      await localStore.importInvestments(investmentUpserts, userId),
      "local-store-import-investments",
    );
  }
  if (watchlistUpserts.length > 0) {
    unwrapLocalStoreResult(
      await localStore.importWatchlist(watchlistUpserts, userId),
      "local-store-import-watchlist",
    );
  }

  for (const id of investmentDeletes) {
    unwrapLocalStoreResult(
      await localStore.deleteInvestmentSilent(id),
      "local-store-delete-investment-silent",
    );
  }
  for (const id of watchlistDeletes) {
    unwrapLocalStoreResult(
      await localStore.deleteWatchlistItemSilent(id),
      "local-store-delete-watchlist-item-silent",
    );
  }
}

async function pullServerChanges(serverBaseUrl, userId, token, localStore) {
  const lastPulledAt = (await cacheGet(SYNC_CURSOR_CACHE_KEY)) || "1970-01-01T00:00:00.000Z";
  const queryParams = new URLSearchParams({
    userId: String(userId),
    since: withSafetyWindow(lastPulledAt),
    limit: String(DEFAULT_PULL_LIMIT),
  });

  const response = await fetchSyncEndpointWithFallback(
    serverBaseUrl,
    `/api/v1/sync/pull?${queryParams.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response || !response.ok) {
    const status = response?.status ?? "unknown";
    const body = response ? await response.text().catch(() => "") : "";
    throw new Error(`Sync pull failed with status ${status}${body ? ` response: ${body}` : ""}`);
  }

  const data = unwrapApiData(await response.json());
  const changes = Array.isArray(data?.changes) ? data.changes : [];
  await applyPulledChanges(changes, localStore, userId);

  const newestChangeTs = changes
    .map((change) => String(change?.updatedAt || ""))
    .filter((ts) => ts.length > 0)
    .sort()
    .at(-1);
  const nextCursor = String(newestChangeTs || data?.serverTime || new Date().toISOString());
  await cacheSet(SYNC_CURSOR_CACHE_KEY, nextCursor);
}

export async function runDesktopSyncNowIfDue(options = {}) {
  if (!isDesktopWithLocalStore()) {
    return { skipped: true, reason: "not-desktop" };
  }

  const force = Boolean(options?.force);
  const now = Date.now();
  if (inFlightSyncPromise) {
    return inFlightSyncPromise;
  }
  if (!force && now - lastSyncAtMs < SYNC_MIN_INTERVAL_MS) {
    return { skipped: true, reason: "cooldown" };
  }

  inFlightSyncPromise = (async () => {
    try {
      const config = await window.electronAPI.serverConfig.get();
      const configured = Boolean(
        config?.configured || String(config?.serverUrl || "").trim().length > 0,
      );
      if (!configured || !config?.serverUrl) {
        return { skipped: true, reason: "server-not-configured" };
      }

      const session = await getSession();
      if (!session?.token) {
        return { skipped: true, reason: "no-session-token" };
      }

      const serverBaseUrl = normalizeServerBaseUrl(config.serverUrl);
      const userId = parseUserId(session.user);
      const localStore = window.electronAPI.localStore;
      await pushPendingOperations(serverBaseUrl, userId, session.token, localStore);
      await pullServerChanges(serverBaseUrl, userId, session.token, localStore);

      lastSyncAtMs = Date.now();
      return { skipped: false, reason: "ok" };
    } finally {
      inFlightSyncPromise = null;
    }
  })();

  return inFlightSyncPromise;
}

export function startDesktopAutoSync() {
  if (!isDesktopWithLocalStore() || autoSyncStarted) {
    return () => {};
  }

  autoSyncStarted = true;

  const trigger = () => {
    runDesktopSyncNowIfDue().catch((error) => {
      console.warn("[desktop-sync] auto sync failed", error);
    });
  };

  // Initial sync shortly after app startup.
  setTimeout(trigger, 1500);
  autoSyncIntervalId = setInterval(trigger, AUTO_SYNC_INTERVAL_MS);

  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      trigger();
    }
  };

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return () => {
    if (autoSyncIntervalId) {
      clearInterval(autoSyncIntervalId);
      autoSyncIntervalId = null;
    }
    if (typeof document !== "undefined" && document.removeEventListener) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    autoSyncStarted = false;
  };
}
