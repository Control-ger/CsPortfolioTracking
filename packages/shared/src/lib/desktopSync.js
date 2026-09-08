import { getSession, logout, validateSession } from "./auth.js";
import { translate } from "./i18n/index.js";
import { reportSessionRejected } from "./sessionHealthBus.js";
import { get as cacheGet, set as cacheSet } from "./localCache.js";
import { unwrapLocalStoreResult } from "./localStoreResult.js";
import { normalizeServerBaseUrl } from "./serverConfig.js";
import {
  fetchWithCloudflareAccess,
  isCloudflareAccessChallengeResponse,
} from "./cloudflareAccess.js";
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

function isHtmlResponse(response) {
  return String(response?.headers?.get?.("content-type") || "")
    .toLowerCase()
    .includes("text/html");
}

// A JSON 401/403 is the server's own verdict on the session — it carries the
// error code handleDeadSessionResponse acts on. No other candidate URL can
// improve on that, so it ends the search instead of being kept as a runner-up.
function isAuthoritativeAuthFailure(response) {
  if (!response || (response.status !== 401 && response.status !== 403)) {
    return false;
  }
  return !isHtmlResponse(response);
}

async function fetchSyncEndpointWithFallback(serverBaseUrl, endpointPath, options) {
  const candidates = buildSyncEndpointCandidates(serverBaseUrl, endpointPath);
  if (candidates.length === 0) {
    throw new Error(translate("common:runtimeErrors.endpointBuildFailed"));
  }

  let lastResponse = null;
  let firstNon404Response = null;
  let htmlFallbackResponse = null;
  let lastError = null;
  let sawAccessChallenge = false;
  for (const url of candidates) {
    try {
      const response = await fetchWithCloudflareAccess(url, options, serverBaseUrl);
      // The deployed server answers every path it does not route to the API with
      // the SPA, so `/index.php/api/v1/sync/pull` returns 200 text/html. Taking
      // that as success threw away the authoritative 401 an earlier candidate had
      // already produced: the sync then died with "HTML instead of JSON" on every
      // run and the expired session was never recognised as expired, so the app
      // 401'd forever with no way back to a login prompt. HTML is never an API
      // answer — remember it as a last resort and keep looking.
      if (response?.ok) {
        if (!isHtmlResponse(response)) {
          return response;
        }
        htmlFallbackResponse = htmlFallbackResponse || response;
        continue;
      }
      if (isCloudflareAccessChallengeResponse(response)) {
        sawAccessChallenge = true;
      } else if (isAuthoritativeAuthFailure(response)) {
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

  // fetchWithCloudflareAccess already tried a silent cookie refresh and a login
  // window on each candidate. A challenge that survives both is a real "not
  // signed in to Cloudflare" — say so, instead of letting it surface as an
  // opaque "status 403 <html>" the UI cannot tell apart from a server error.
  // PortfolioPage matches on this wording to show the re-login hint.
  if (sawAccessChallenge) {
    throw new Error(
      translate("common:runtimeErrors.cloudflareLoginRequired"),
    );
  }

  if (firstNon404Response) {
    return firstNon404Response;
  }
  if (lastResponse) {
    return lastResponse;
  }
  if (htmlFallbackResponse) {
    return htmlFallbackResponse;
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

function unwrapApiData(payload) {
  return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

// A 401 carrying one of these codes means the stored token is definitively
// unusable against this server — not a transient outage. Keeping it would
// reproduce the original failure mode: the app looks logged in and every sync
// call 401s forever, with no path back to a working session.
// USER_SCOPE_FORBIDDEN (403) is deliberately NOT listed: that is a scope
// mismatch on an otherwise valid session and must not log the user out.
const DEAD_SESSION_ERROR_CODES = new Set(["AUTH_REQUIRED", "INVALID_SESSION", "MISSING_TOKEN"]);

// Guard so a burst of parallel sync calls triggers exactly one recovery.
// Reset after every successful sync — a session that works now can still be
// rejected later (expiry, server key rotation).
let deadSessionHandled = false;

async function handleDeadSessionResponse(response, bodyText) {
  if (!response || response.status !== 401) {
    return false;
  }

  let code = "";
  try {
    code = String(JSON.parse(bodyText)?.error?.code || "");
  } catch {
    // Non-JSON body (e.g. a Cloudflare page) — not an authoritative auth verdict.
    return false;
  }

  if (!DEAD_SESSION_ERROR_CODES.has(code)) {
    return false;
  }

  if (!deadSessionHandled) {
    deadSessionHandled = true;
    console.warn("[desktop-sync] server rejected the stored session, clearing it", { code });
    try {
      await logout();
    } catch (error) {
      console.warn("[desktop-sync] failed to clear the rejected session", error);
    }
    reportSessionRejected(code);
  }

  return true;
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
        : entityType === "sale"
          ? "sales"
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
      } else if (normalized.table === "sales" && typeof localStore.getSale === "function") {
        const existing = unwrapLocalStoreResult(
          await localStore.getSale(normalized.id),
          "local-store-get-sale",
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

/**
 * Sync tables this server has rejected as unknown.
 *
 * A desktop build can be newer than the server it talks to — the app updates
 * itself, the server is redeployed separately. When it is, the server answers a
 * push containing an entity it does not know with a **400 for the whole batch**,
 * so one unknown change would otherwise block every investment and watchlist
 * change queued behind it, retrying every minute forever.
 *
 * Such operations must not be retired: unlike an unmappable entity type, they
 * become valid the moment the server catches up. They are held back instead,
 * and stay pending until then.
 *
 * Session-scoped on purpose: a redeployed server should be retried without
 * requiring an app restart, and the next launch starts from a clean slate.
 */
const serverRejectedTables = new Set();

/** `Invalid table at index 0: sales` → `sales`. */
function readRejectedTable(body) {
  const match = /invalid table at index \d+:\s*([a-z_]+)/i.exec(String(body || ""));
  return match ? match[1].toLowerCase() : null;
}

async function pushPendingOperations(serverBaseUrl, syncIdentity, token, localStore, localUserId) {
  // Sales recorded while sale sync was still off carry `dirty = 1` and no
  // operation — queueing them then would have been discarded by the retire path
  // below. This picks them up once; it is a no-op as soon as none are left.
  if (typeof localStore.enqueueDirtySaleOperations === "function") {
    try {
      await localStore.enqueueDirtySaleOperations(localUserId);
    } catch (backfillError) {
      console.warn("[desktop-sync] sale backfill failed", backfillError);
    }
  }

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

  const sendBatch = async (batch) =>
    fetchSyncEndpointWithFallback(serverBaseUrl, "/api/v1/sync/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        // Cloudflare Access strips Authorization on the way to the origin, so the
        // server sees no token at all (observed: MISSING_TOKEN / AUTH_REQUIRED on
        // every sync call). X-Auth-Token survives the tunnel; both the validate
        // route and RequestUserScopeResolver already accept it as an alternative.
        "X-Auth-Token": token,
      },
      body: JSON.stringify({
        ...buildSyncIdentityPayload(syncIdentity.userId, syncIdentity.steamId),
        changes: batch.map((operation) => ({
          op: operation.op,
          table: operation.table,
          id: operation.id,
          payload: operation.payload,
          idempotencyKey: operation.idempotencyKey,
          clientRevision: operation.clientRevision,
        })),
      }),
    });

  const withoutRejectedTables = (batch) =>
    serverRejectedTables.size === 0
      ? batch
      : batch.filter((operation) => !serverRejectedTables.has(String(operation.table)));

  mapped = withoutRejectedTables(mapped);
  if (mapped.length === 0) {
    return;
  }

  let response = await sendBatch(mapped);

  if (response && response.status === 400) {
    const body = await response.clone().text().catch(() => "");
    const rejectedTable = readRejectedTable(body);
    if (rejectedTable) {
      // Learn it, hold those operations back — they stay pending and go through
      // once the server understands them — and let the rest of the batch land.
      serverRejectedTables.add(rejectedTable);
      console.warn("[desktop-sync] server does not accept this table yet, holding it back", {
        table: rejectedTable,
      });
      mapped = withoutRejectedTables(mapped);
      if (mapped.length === 0) {
        return;
      }
      response = await sendBatch(mapped);
    }
  }

  if (!response || !response.ok) {
    const status = response?.status ?? "unknown";
    const body = response ? await response.text().catch(() => "") : "";
    if (await handleDeadSessionResponse(response, body)) {
      throw new Error(
        translate("common:runtimeErrors.pushSessionRejected"),
      );
    }
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
  const saleUpserts = [];
  const investmentDeletes = [];
  const watchlistDeletes = [];
  const saleDeletes = [];

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
      } else if (table === "sales") {
        saleDeletes.push(id);
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
    } else if (table === "sales") {
      saleUpserts.push(normalized);
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
  if (saleUpserts.length > 0 && typeof localStore.importSales === "function") {
    unwrapLocalStoreResult(
      await localStore.importSales(saleUpserts, localUserId),
      "local-store-import-sales",
    );
  }

  for (const id of investmentDeletes) {
    unwrapLocalStoreResult(
      await localStore.deleteInvestmentSilent(id),
      "local-store-delete-investment-silent",
    );
  }
  for (const id of saleDeletes) {
    if (typeof localStore.deleteSaleSilent === "function") {
      unwrapLocalStoreResult(
        await localStore.deleteSaleSilent(id),
        "local-store-delete-sale-silent",
      );
    }
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
        // See push above: Cloudflare Access drops Authorization, X-Auth-Token survives.
        "X-Auth-Token": token,
      },
    },
  );

  if (!response || !response.ok) {
    const status = response?.status ?? "unknown";
    const body = response ? await response.text().catch(() => "") : "";
    if (await handleDeadSessionResponse(response, body)) {
      throw new Error(
        translate("common:runtimeErrors.pullSessionRejected"),
      );
    }
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
      deadSessionHandled = false;
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
