import { getSession, validateSession } from "./auth.js";
import { get as cacheGet, set as cacheSet } from "./localCache.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";
import { normalizeServerBaseUrl, resolveAccessBaseUrl } from "./serverConfig.js";
import {
  normalizeDesktopLocalUserId,
  parseDesktopSyncUserId,
  resolveDesktopLocalUserId,
} from "./userIdentity.js";

const SYNC_CURSOR_CACHE_KEY_PREFIX = "desktop-sync:last-pull-at";
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

  if (response.status === 404) {
    // No get-identity endpoint = no CF Access app.
    return true;
  }
  if (response.status === 401 || response.status === 403) {
    return false;
  }

  // Read the body as text regardless of content-type: CF serves the
  // get-identity error (e.g. {"err":"no app token set"}) without a reliable
  // application/json header, so content-type sniffing would miss it.
  const bodyText = await response.text().catch(() => "");
  let payload = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    payload = null;
  }

  const errText = (String(payload?.err || "") || bodyText).toLowerCase();
  if (errText.includes("no app token") || errText.includes("not set")) {
    // No usable Access token for this host. Don't preemptively open a login
    // window here — a genuinely protected endpoint will return a CF challenge,
    // and that challenge path drives the login. This avoids popup loops on hosts
    // without an Access app while still logging in when one exists.
    return true;
  }
  if (payload?.err) {
    console.log("[desktop-sync] CF Access error:", payload.err);
    return false;
  }

  // Any other non-OK status: defer to challenge detection rather than forcing a
  // login window from here.
  if (!response.ok) {
    return true;
  }

  return Boolean(payload && typeof payload === "object" && !payload.err);
}

function buildSyncEndpointCandidates(serverBaseUrl, endpointPath) {
  const normalizedBase = normalizeServerBaseUrl(serverBaseUrl);
  const rawEndpoint = String(endpointPath || "");
  const queryStart = rawEndpoint.indexOf("?");
  const endpointPathOnly = queryStart >= 0 ? rawEndpoint.slice(0, queryStart) : rawEndpoint;
  const endpointQuery = queryStart >= 0 ? rawEndpoint.slice(queryStart + 1) : "";
  const endpoint = endpointPathOnly.startsWith("/") ? endpointPathOnly : `/${endpointPathOnly}`;

  if (!normalizedBase || !endpoint) {
    return [];
  }

  const lower = normalizedBase.toLowerCase();
  const candidates = [];
  const joinWithQuery = (baseUrl, queryTail) => {
    if (!queryTail) {
      return baseUrl;
    }
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${queryTail}`;
  };
  const routeParam = `route=${encodeURIComponent(endpoint)}`;
  const routeWithQuery = endpointQuery ? `${routeParam}&${endpointQuery}` : routeParam;

  if (lower.endsWith("/api/index.php")) {
    candidates.push(joinWithQuery(`${normalizedBase}${endpoint}`, endpointQuery));
    candidates.push(joinWithQuery(`${normalizedBase.slice(0, -"/api/index.php".length)}${endpoint}`, endpointQuery));
    candidates.push(joinWithQuery(normalizedBase, routeWithQuery));
  } else if (lower.endsWith("/api")) {
    candidates.push(joinWithQuery(`${normalizedBase}${endpoint}`, endpointQuery));
    candidates.push(joinWithQuery(`${normalizedBase}/index.php${endpoint}`, endpointQuery));
    candidates.push(joinWithQuery(`${normalizedBase}/index.php`, routeWithQuery));
    candidates.push(joinWithQuery(`${normalizedBase.slice(0, -"/api".length)}${endpoint}`, endpointQuery));
  } else {
    // The deployed server routes the API only through /api/index.php; the bare
    // /api/v1/... path returns 404. The fallback below still recovers, but trying
    // the bare path first spams the console with 404s on every sync — so try the
    // working /api/index.php form first and keep the bare path as a fallback.
    candidates.push(joinWithQuery(`${normalizedBase}/api/index.php${endpoint}`, endpointQuery));
    candidates.push(joinWithQuery(`${normalizedBase}/api/index.php`, routeWithQuery));
    candidates.push(joinWithQuery(`${normalizedBase}${endpoint}`, endpointQuery));
    candidates.push(joinWithQuery(`${normalizedBase}/index.php${endpoint}`, endpointQuery));
    candidates.push(joinWithQuery(`${normalizedBase}/index.php`, routeWithQuery));
  }

  return Array.from(new Set(candidates));
}

async function fetchSyncEndpointWithFallback(serverBaseUrl, endpointPath, options) {
  const candidates = buildSyncEndpointCandidates(serverBaseUrl, endpointPath);
  if (candidates.length === 0) {
    throw new Error("Sync endpoint URL konnte nicht aufgebaut werden.");
  }

  let lastResponse = null;
  let firstNon404Response = null;
  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetchWithCloudflareAccess(url, options, serverBaseUrl);
      if (response?.ok) {
        return response;
      }
      lastResponse = response;
      if (response && response.status !== 404 && !firstNon404Response) {
        firstNon404Response = response;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (firstNon404Response) {
    return firstNon404Response;
  }
  if (lastResponse) {
    return lastResponse;
  }
  if (lastError) {
    throw lastError;
  }

  throw new Error("Sync endpoint request failed before receiving a response.");
}

function operationMatchesResult(operation, result) {
  if (!result || typeof result !== "object") {
    return false;
  }

  const sameTable = String(result.table || "") === String(operation.table || "");
  const sameId = String(result.id || "") === String(operation.id || "");
  if (!sameTable || !sameId) {
    return false;
  }

  const op = String(operation.op || "").toLowerCase();
  const resultOp = String(result.op || "").toLowerCase();
  if (!op || !resultOp) {
    return true;
  }

  return op === resultOp;
}

function findResultForOperation(operation, results, usedResultIndexes) {
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const idempotencyKey = String(operation?.idempotencyKey || "");
  if (idempotencyKey) {
    for (let index = 0; index < results.length; index += 1) {
      if (usedResultIndexes.has(index)) {
        continue;
      }
      const candidate = results[index];
      if (String(candidate?.idempotencyKey || "") === idempotencyKey) {
        return { result: candidate, index };
      }
    }
  }

  for (let index = 0; index < results.length; index += 1) {
    if (usedResultIndexes.has(index)) {
      continue;
    }
    const candidate = results[index];
    if (operationMatchesResult(operation, candidate)) {
      return { result: candidate, index };
    }
  }

  return null;
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

  const hasIdentityAfterLogin = await hasCloudflareAccessIdentity(accessBaseUrl).catch(() => false);
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

  const cfLoginUrl = response.url;
  const loginResult = await window.electronAPI.cloudflareAccess.login(resolveAccessBaseUrl(serverBaseUrl), cfLoginUrl);
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

function resolveSteamIdFromUser(user) {
  const candidates = [
    user?.steamId,
    user?.steam_id,
    String(user?.id || "").startsWith("steam-") ? String(user.id).slice("steam-".length) : null,
    String(user?.userId || "").startsWith("steam-") ? String(user.userId).slice("steam-".length) : null,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (/^[1-9]\d{10,}$/.test(value)) {
      return value;
    }
  }

  return null;
}

function buildSyncIdentityPayload(syncUserId, steamId) {
  const payload = {};
  if (Number.isInteger(syncUserId) && syncUserId > 0) {
    payload.userId = syncUserId;
  }
  if (steamId) {
    payload.steamId = steamId;
  }
  return payload;
}

function getSyncCursorCacheKey(syncUserId, steamId, localUserId) {
  if (Number.isInteger(syncUserId) && syncUserId > 0) {
    return `${SYNC_CURSOR_CACHE_KEY_PREFIX}:user:${syncUserId}`;
  }
  if (steamId) {
    return `${SYNC_CURSOR_CACHE_KEY_PREFIX}:steam:${steamId}`;
  }
  return `${SYNC_CURSOR_CACHE_KEY_PREFIX}:local:${localUserId || "1"}`;
}

function operationBelongsToLocalUser(operation, localUserId) {
  const payload = operation && typeof operation.payload === "object" && operation.payload !== null
    ? operation.payload
    : {};
  const rawUserId = payload.userId ?? payload.user_id;
  if (rawUserId === null || rawUserId === undefined || String(rawUserId).trim() === "") {
    return String(localUserId) === "1";
  }

  return normalizeDesktopLocalUserId(rawUserId, "1") === String(localUserId);
}

// Foreign ops with a purely numeric (or missing) user scope are legacy artifacts —
// desktop scopes are `steam-<steamId>` and legacy scope "1" is migrated on access,
// so a numeric-scope op can never be claimed and pushed by any account. They must
// be retired, not skipped: listPendingOperations serves the oldest 200 ops, so a
// block of >=200 unclaimable ops permanently occupies the push window and silently
// stops ALL sync pushes (observed with stale scope-"4" ops from an old build).
function isRetiredForeignOperation(operation) {
  const payload = operation && typeof operation.payload === "object" && operation.payload !== null
    ? operation.payload
    : {};
  const rawUserId = payload.userId ?? payload.user_id;
  if (rawUserId === null || rawUserId === undefined || String(rawUserId).trim() === "") {
    return true;
  }
  return /^\d+$/.test(normalizeDesktopLocalUserId(rawUserId, "1"));
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
  const payload = normalized.payload && typeof normalized.payload === "object"
    ? { ...normalized.payload }
    : {};
  const hasValidClientRevision =
    Number.isFinite(Number(normalized.clientRevision)) && Number(normalized.clientRevision) > 0;

  if (!hasValidClientRevision) {
    try {
      if (normalized.table === "investments" && typeof localStore.getInvestment === "function") {
        const existing = unwrapLocalStoreResult(
          await localStore.getInvestment(normalized.id),
          "local-store-get-investment",
        );
        const revision = Number(existing?.revision || 0);
        if (Number.isFinite(revision) && revision > 0) {
          normalized.clientRevision = Math.floor(revision);
        }
      } else if (
        normalized.table === "watchlist_items" &&
        typeof localStore.getWatchlistItem === "function"
      ) {
        const existing = unwrapLocalStoreResult(
          await localStore.getWatchlistItem(normalized.id),
          "local-store-get-watchlist-item",
        );
        const revision = Number(existing?.revision || 0);
        if (Number.isFinite(revision) && revision > 0) {
          normalized.clientRevision = Math.floor(revision);
        }
      }
    } catch (error) {
      console.warn("[desktop-sync] failed to resolve local revision for operation", {
        table: normalized.table,
        id: normalized.id,
        error: error?.message || String(error),
      });
    }
  }

  if (normalized.table !== "investments" || normalized.op !== "upsert") {
    normalized.payload = payload;
    return normalized;
  }

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
        if (!hasValidClientRevision) {
          const revision = Number(existing?.revision || 0);
          if (Number.isFinite(revision) && revision > 0) {
            normalized.clientRevision = Math.floor(revision);
          }
        }
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

async function pushPendingOperations(serverBaseUrl, syncIdentity, token, localStore, localUserId) {
  let mapped = [];

  // Retiring a full window of junk ops uncovers the next window; keep fetching
  // until pushable ops surface or the queue is drained. Retired ops are marked
  // applied before the next fetch, so every pass sees a strictly smaller queue.
  for (;;) {
    const pending = unwrapLocalStoreResult(
      await localStore.listPendingOperations(200),
      "local-store-list-pending-operations",
    );
    if (!Array.isArray(pending) || pending.length === 0) {
      return;
    }

    mapped = [];
    const retiredOperationIds = [];
    for (const operation of pending) {
      if (!operationBelongsToLocalUser(operation, localUserId)) {
        if (isRetiredForeignOperation(operation)) {
          retiredOperationIds.push(operation.id);
        }
        continue;
      }
      const base = mapOperationToSyncChange(operation);
      if (!base) {
        // Unknown entity types can never be mapped to a sync change; retire them so
        // they cannot clog the oldest-first push window either.
        retiredOperationIds.push(operation.id);
        continue;
      }
      const enriched = await enrichSyncChange(base, localStore);
      if (enriched) {
        mapped.push(enriched);
      }
    }

    for (const retiredOperationId of retiredOperationIds) {
      unwrapLocalStoreResult(
        await localStore.markOperationApplied(retiredOperationId),
        "local-store-mark-operation-applied",
      );
    }
    if (retiredOperationIds.length > 0) {
      console.info("[desktop-sync] retired unclaimable pending operations", {
        count: retiredOperationIds.length,
      });
    }

    if (mapped.length > 0) {
      break;
    }
    if (retiredOperationIds.length === 0) {
      return;
    }
  }

  const response = await fetchSyncEndpointWithFallback(serverBaseUrl, "/api/v1/sync/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      ...buildSyncIdentityPayload(syncIdentity.userId, syncIdentity.steamId),
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

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    await response.text().catch(() => "");
    throw new Error(`Sync push received HTML response instead of JSON. Server could be returning an error page or a captive portal. URL: ${response.url}, Status: ${response.status}`);
  }
  const data = unwrapApiData(await response.json());
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) {
    return;
  }

  if (results.length !== mapped.length) {
    console.warn("[desktop-sync] sync push returned unexpected result count", {
      expected: mapped.length,
      received: results.length,
    });
  }

  const usedResultIndexes = new Set();
  for (let index = 0; index < mapped.length; index += 1) {
    const op = mapped[index];
    let matched = null;

    const indexedResult = results[index];
    if (operationMatchesResult(op, indexedResult)) {
      matched = { result: indexedResult, index };
    } else {
      matched = findResultForOperation(op, results, usedResultIndexes);
    }

    if (!matched?.result) {
      console.warn("[desktop-sync] missing sync push result for operation", {
        table: op.table,
        id: op.id,
        idempotencyKey: op.idempotencyKey,
      });
      continue;
    }

    usedResultIndexes.add(matched.index);
    const matchedResult = matched.result;
    const status = String(matchedResult?.status || "");
    const rejected = status === "rejected" ? matchedResult : null;
    const applied = status === "applied";
    const conflict = status === "conflict";
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
        idempotencyKey: op.idempotencyKey,
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

async function applyPulledChanges(changes, localStore, localUserId) {
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
      userId: localUserId,
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
      await localStore.importInvestments(investmentUpserts, localUserId),
      "local-store-import-investments",
    );
  }
  if (watchlistUpserts.length > 0) {
    unwrapLocalStoreResult(
      await localStore.importWatchlist(watchlistUpserts, localUserId),
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

async function pullServerChanges(serverBaseUrl, syncIdentity, token, localStore, localUserId) {
  const cursorCacheKey = getSyncCursorCacheKey(
    syncIdentity.userId,
    syncIdentity.steamId,
    localUserId,
  );
  const lastPulledAt = (await cacheGet(cursorCacheKey)) || "1970-01-01T00:00:00.000Z";
  const queryParams = new URLSearchParams({
    since: withSafetyWindow(lastPulledAt),
    limit: String(DEFAULT_PULL_LIMIT),
  });
  const identityPayload = buildSyncIdentityPayload(syncIdentity.userId, syncIdentity.steamId);
  Object.entries(identityPayload).forEach(([key, value]) => {
    queryParams.set(key, String(value));
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

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    await response.text().catch(() => "");
    throw new Error(`Sync pull received HTML response instead of JSON. Server could be returning an error page or a captive portal. URL: ${response.url}, Status: ${response.status}`);
  }
  const data = unwrapApiData(await response.json());
  const changes = Array.isArray(data?.changes) ? data.changes : [];
  await applyPulledChanges(changes, localStore, localUserId);

  const newestChangeTs = changes
    .map((change) => String(change?.updatedAt || ""))
    .filter((ts) => ts.length > 0)
    .sort()
    .at(-1);
  const nextCursor = String(newestChangeTs || data?.serverTime || new Date().toISOString());
  await cacheSet(cursorCacheKey, nextCursor);
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
      const localUserId = resolveDesktopLocalUserId(session.user, 1);
      let syncUserId = parseDesktopSyncUserId(session.user);
      let steamId = resolveSteamIdFromUser(session.user);
      if (syncUserId === null && steamId === null) {
        const validated = await validateSession(session.token);
        syncUserId = parseDesktopSyncUserId(validated?.user);
        steamId = resolveSteamIdFromUser(validated?.user);
      }
      if (syncUserId === null && steamId === null) {
        return { skipped: true, reason: "no-valid-session-user-id" };
      }
      const localStore = window.electronAPI.localStore;
      const syncIdentity = { userId: syncUserId, steamId };
      await pushPendingOperations(serverBaseUrl, syncIdentity, session.token, localStore, localUserId);
      await pullServerChanges(serverBaseUrl, syncIdentity, session.token, localStore, localUserId);

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
