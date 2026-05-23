import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchCsUpdatesFeed } from "@shared/lib/apiClient";
import { getMockCsUpdatesFeed } from "@shared/lib/csUpdatesFeed.mock";

const DEFAULT_STALE_AFTER_SECONDS = 6 * 60 * 60;
const DEFAULT_BANNER_VISIBLE_HOURS = 24 * 7;
const MAX_BANNER_VISIBLE_HOURS = 24 * 30;
const DEFAULT_FEED_WINDOW_DAYS = 7;
const DEFAULT_PAGE_SIZE = 30;
const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;
const FALLBACK_POLL_INTERVAL_MS = 15 * 1000;
const WS_RECONNECT_BACKOFF_STEPS_MS = [1000, 2000, 5000, 10000, 30000];
const WS_RECONNECT_COOLDOWN_MS = 5 * 60 * 1000;

function isWsRealtimeEnabled() {
  const rawValue = String(import.meta.env.VITE_CS_UPDATES_WS_ENABLED ?? "")
    .trim()
    .toLowerCase();

  if (!rawValue) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(rawValue);
}

function toTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sortFeedItems(items) {
  return [...items].sort((a, b) => {
    const aTime = toTimestamp(a.publishedAt) ?? 0;
    const bTime = toTimestamp(b.publishedAt) ?? 0;

    if (bTime !== aTime) {
      return bTime - aTime;
    }

    return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  });
}

function resolveFeedWindowDays(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_FEED_WINDOW_DAYS;
  }
  return Math.max(1, Math.min(30, Math.round(parsed)));
}

function getFeedSinceIso(windowDays = DEFAULT_FEED_WINDOW_DAYS) {
  const since = new Date(Date.now() - resolveFeedWindowDays(windowDays) * TWENTY_FOUR_HOURS_IN_MS);
  return since.toISOString();
}

function normalizeFeedPayload(payload) {
  const rawData = payload?.data ?? payload;
  const meta = payload?.meta ?? rawData?.meta ?? {};
  const items = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData?.items)
      ? rawData.items
      : [];

  return {
    items: sortFeedItems(items),
    meta: {
      sourceMode: meta.sourceMode || "backend",
      fetchedAt: meta.fetchedAt || null,
      lastRefreshAt: meta.lastRefreshAt || meta.fetchedAt || null,
      staleAfterSeconds: Number.isFinite(meta.staleAfterSeconds)
        ? meta.staleAfterSeconds
        : DEFAULT_STALE_AFTER_SECONDS,
      bannerVisibleHours: (() => {
        const parsed = Number(meta.bannerVisibleHours);
        if (!Number.isFinite(parsed)) {
          return DEFAULT_BANNER_VISIBLE_HOURS;
        }
        return Math.max(1, Math.min(MAX_BANNER_VISIBLE_HOURS, parsed));
      })(),
      isStale: Boolean(meta.isStale),
      nextBefore: typeof meta.nextBefore === "string" ? meta.nextBefore : null,
      hasMore: Boolean(meta.hasMore),
      defaultWindowDays: resolveFeedWindowDays(meta.defaultWindowDays),
    },
  };
}

function deriveFreshness(items, meta) {
  const now = Date.now();
  const fetchedAt = toTimestamp(meta.fetchedAt);
  const staleAfterSeconds = Number(meta.staleAfterSeconds || DEFAULT_STALE_AFTER_SECONDS);
  const staleByTime = fetchedAt !== null
    ? now - fetchedAt > staleAfterSeconds * 1000
    : false;
  const latestItem = items[0] || null;
  const latestItemTime = latestItem ? toTimestamp(latestItem.publishedAt) : null;
  const latestItemAgeHours = latestItemTime !== null
    ? Math.max(0, (now - latestItemTime) / (1000 * 60 * 60))
    : null;
  const freshItemIds = items
    .filter((item) => {
      const itemTime = toTimestamp(item.publishedAt);
      return itemTime !== null && now - itemTime <= TWENTY_FOUR_HOURS_IN_MS;
    })
    .map((item) => item.id);
  const newestFreshItem =
    latestItemTime !== null && now - latestItemTime <= TWENTY_FOUR_HOURS_IN_MS
      ? latestItem
      : items.find((item) => freshItemIds.includes(item.id)) || null;

  return {
    latestItem,
    latestItemAgeHours,
    newestFreshItem,
    freshItemIds,
    isStale: meta.isStale || staleByTime,
    fetchedAt,
  };
}

function mergeFeedCollections(prevItems, incomingItems) {
  return (Array.isArray(incomingItems) ? incomingItems : []).reduce(
    (accumulator, item) => mergeIncomingItem(accumulator, item),
    [...prevItems],
  );
}

function mergeIncomingItem(prevItems, item) {
  const itemId = String(item?.id || "").trim();
  const externalId = String(item?.externalId || item?.external_id || "").trim();
  const nextItems = [...prevItems];
  const existingIndex = nextItems.findIndex((entry) => {
    if (itemId && String(entry?.id || "").trim() === itemId) {
      return true;
    }
    if (externalId) {
      const existingExternalId = String(entry?.externalId || entry?.external_id || "").trim();
      return existingExternalId !== "" && existingExternalId === externalId;
    }
    return false;
  });

  if (existingIndex >= 0) {
    nextItems[existingIndex] = { ...nextItems[existingIndex], ...item };
  } else {
    nextItems.unshift(item);
  }

  return sortFeedItems(nextItems);
}

function resolveWsUrl() {
  const configured = String(import.meta.env.VITE_CS_UPDATES_WS_URL || "").trim();
  if (configured) {
    return configured;
  }

  if (typeof window === "undefined") {
    return null;
  }
  if (!window.location.host) {
    return null;
  }

  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${window.location.host}/ws/updates`;
}

async function defaultLoader(options = {}) {
  const hasCustomSince = typeof options?.since === "string" && options.since.trim() !== "";
  const hasBefore = typeof options?.before === "string" && options.before.trim() !== "";
  const resolvedSince = hasCustomSince
    ? options.since
    : hasBefore
      ? undefined
      : getFeedSinceIso(DEFAULT_FEED_WINDOW_DAYS);

  return fetchCsUpdatesFeed({
    limit: Number.isFinite(options?.limit) ? options.limit : DEFAULT_PAGE_SIZE,
    before: typeof options?.before === "string" ? options.before : undefined,
    since: resolvedSince,
  });
}

export function useCsUpdatesFeed({ loader = defaultLoader } = {}) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({
    sourceMode: "backend",
    fetchedAt: null,
    lastRefreshAt: null,
    staleAfterSeconds: DEFAULT_STALE_AFTER_SECONDS,
    bannerVisibleHours: DEFAULT_BANNER_VISIBLE_HOURS,
    isStale: false,
    nextBefore: null,
    hasMore: false,
    defaultWindowDays: DEFAULT_FEED_WINDOW_DAYS,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [windowDays, setWindowDays] = useState(DEFAULT_FEED_WINDOW_DAYS);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const fallbackPollTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const wsDisabledUntilRef = useRef(0);
  const manualRefreshRef = useRef(false);

  const load = useCallback(
    async (mode = "initial") => {
      const isRefresh = mode === "refresh";
      const isLoadOlder = mode === "older";

      if (isLoadOlder) {
        if (!nextBefore) {
          setHasMore(false);
          return;
        }
        setIsLoadingOlder(true);
      } else if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      if (!manualRefreshRef.current && !isLoadOlder) {
        setError(null);
      }

      try {
        const requestParams = isLoadOlder
          ? {
              limit: DEFAULT_PAGE_SIZE,
              before: nextBefore,
            }
          : {
              limit: DEFAULT_PAGE_SIZE,
              since: getFeedSinceIso(windowDays),
            };
        const payload = await loader(requestParams);
        const normalized = normalizeFeedPayload(payload);
        if (isLoadOlder) {
          setItems((prevItems) => mergeFeedCollections(prevItems, normalized.items));
        } else {
          setItems(normalized.items);
        }
        setMeta(normalized.meta);
        setNextBefore(normalized.meta.nextBefore);
        setHasMore(Boolean(normalized.meta.hasMore && normalized.meta.nextBefore));
        setWindowDays(resolveFeedWindowDays(normalized.meta.defaultWindowDays));
      } catch (loadError) {
        setError(loadError?.message || "CS Updates konnten nicht geladen werden.");

        if (mode === "initial") {
          const fallbackPayload = await getMockCsUpdatesFeed();
          const fallbackNormalized = normalizeFeedPayload(fallbackPayload);
          setItems(fallbackNormalized.items);
          setMeta({
            ...fallbackNormalized.meta,
            sourceMode: "mock-fallback",
            nextBefore: null,
            hasMore: false,
          });
          setNextBefore(null);
          setHasMore(false);
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingOlder(false);
        manualRefreshRef.current = false;
      }
    },
    [loader, nextBefore, windowDays],
  );

  const startFallbackPolling = useCallback(() => {
    if (fallbackPollTimerRef.current) {
      return;
    }

    fallbackPollTimerRef.current = setInterval(() => {
      void load("refresh");
    }, FALLBACK_POLL_INTERVAL_MS);
  }, [load]);

  const stopFallbackPolling = useCallback(() => {
    if (!fallbackPollTimerRef.current) {
      return;
    }
    clearInterval(fallbackPollTimerRef.current);
    fallbackPollTimerRef.current = null;
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!isWsRealtimeEnabled()) {
      startFallbackPolling();
      return;
    }

    const now = Date.now();
    if (wsDisabledUntilRef.current > now) {
      startFallbackPolling();
      const remainingMs = wsDisabledUntilRef.current - now;
      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connectWebSocket();
        }, remainingMs);
      }
      return;
    }

    const wsUrl = resolveWsUrl();
    if (!wsUrl || typeof window === "undefined" || typeof WebSocket === "undefined") {
      startFallbackPolling();
      return;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        wsDisabledUntilRef.current = 0;
        stopFallbackPolling();
        ws.send(JSON.stringify({ type: "subscribe", topic: "cs_updates" }));
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || "{}"));
          if (payload?.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
            return;
          }
          if (payload?.type !== "cs_update.created" || !payload?.item) {
            return;
          }

          setItems((prevItems) => mergeIncomingItem(prevItems, payload.item));
          setMeta((prevMeta) => ({
            ...prevMeta,
            sourceMode: "backend",
            fetchedAt: new Date().toISOString(),
            lastRefreshAt: new Date().toISOString(),
            isStale: false,
          }));
        } catch {
          // Ignore malformed WS messages.
        }
      };

      ws.onerror = () => {
        startFallbackPolling();
      };

      ws.onclose = () => {
        wsRef.current = null;
        startFallbackPolling();

        const attempt = reconnectAttemptRef.current;
        const backoffMs = WS_RECONNECT_BACKOFF_STEPS_MS[attempt] || null;
        if (backoffMs === null) {
          reconnectAttemptRef.current = 0;
          wsDisabledUntilRef.current = Date.now() + WS_RECONNECT_COOLDOWN_MS;
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
          }
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connectWebSocket();
          }, WS_RECONNECT_COOLDOWN_MS);
          return;
        }

        reconnectAttemptRef.current = attempt + 1;

        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = setTimeout(() => {
          connectWebSocket();
        }, backoffMs);
      };
    } catch {
      startFallbackPolling();
    }
  }, [startFallbackPolling, stopFallbackPolling]);

  useEffect(() => {
    void load("initial");
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      stopFallbackPolling();
    };
  }, [connectWebSocket, load, stopFallbackPolling]);

  const derived = useMemo(() => deriveFreshness(items, meta), [items, meta]);

  return {
    items,
    meta: {
      ...meta,
      isStale: derived.isStale,
    },
    latestItem: derived.latestItem,
    latestItemAgeHours: derived.latestItemAgeHours,
    newestFreshItem: derived.newestFreshItem,
    freshItemIds: derived.freshItemIds,
    isLoading,
    isRefreshing,
    isLoadingOlder,
    hasMore,
    windowDays,
    error,
    refresh: () => {
      manualRefreshRef.current = true;
      return load("refresh");
    },
    loadOlder: () => load("older"),
  };
}
