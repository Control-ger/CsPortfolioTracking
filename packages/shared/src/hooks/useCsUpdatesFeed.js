import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchCsUpdatesFeed } from "@shared/lib/apiClient";
import { getMockCsUpdatesFeed } from "@shared/lib/csUpdatesFeed.mock";

const DEFAULT_STALE_AFTER_SECONDS = 6 * 60 * 60;
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
      isStale: Boolean(meta.isStale),
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

async function defaultLoader() {
  return fetchCsUpdatesFeed({ limit: 100 });
}

export function useCsUpdatesFeed({ loader = defaultLoader } = {}) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({
    sourceMode: "backend",
    fetchedAt: null,
    lastRefreshAt: null,
    staleAfterSeconds: DEFAULT_STALE_AFTER_SECONDS,
    isStale: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const fallbackPollTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const wsDisabledUntilRef = useRef(0);
  const manualRefreshRef = useRef(false);

  const load = useCallback(
    async (mode = "initial") => {
      const isRefresh = mode === "refresh";

      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      if (!manualRefreshRef.current) {
        setError(null);
      }

      try {
        const payload = await loader();
        const normalized = normalizeFeedPayload(payload);
        setItems(normalized.items);
        setMeta(normalized.meta);
      } catch (loadError) {
        setError(loadError?.message || "CS Updates konnten nicht geladen werden.");

        if (mode === "initial") {
          const fallbackPayload = await getMockCsUpdatesFeed();
          const fallbackNormalized = normalizeFeedPayload(fallbackPayload);
          setItems(fallbackNormalized.items);
          setMeta({ ...fallbackNormalized.meta, sourceMode: "mock-fallback" });
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        manualRefreshRef.current = false;
      }
    },
    [loader],
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
    error,
    refresh: () => {
      manualRefreshRef.current = true;
      return load("refresh");
    },
  };
}
