import { useCallback, useEffect, useMemo, useState } from "react";

import { getMockCsUpdatesFeed } from "@shared/lib/csUpdatesFeed.mock";

const DEFAULT_STALE_AFTER_SECONDS = 6 * 60 * 60;
const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;

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
      sourceMode: meta.sourceMode || "mock",
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
    newestFreshItem,
    freshItemIds,
    isStale: meta.isStale || staleByTime,
    fetchedAt,
  };
}

export function useCsUpdatesFeed({ loader = getMockCsUpdatesFeed } = {}) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({
    sourceMode: "mock",
    fetchedAt: null,
    lastRefreshAt: null,
    staleAfterSeconds: DEFAULT_STALE_AFTER_SECONDS,
    isStale: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(
    async (mode = "initial") => {
      const isRefresh = mode === "refresh";

      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      setError(null);

      try {
        const payload = await loader();
        const normalized = normalizeFeedPayload(payload);
        setItems(normalized.items);
        setMeta(normalized.meta);
      } catch (loadError) {
        setError(loadError?.message || "CS Updates konnten nicht geladen werden.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [loader],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const derived = useMemo(() => deriveFreshness(items, meta), [items, meta]);

  return {
    items,
    meta: {
      ...meta,
      isStale: derived.isStale,
    },
    latestItem: derived.latestItem,
    newestFreshItem: derived.newestFreshItem,
    freshItemIds: derived.freshItemIds,
    isLoading,
    isRefreshing,
    error,
    refresh: () => load("refresh"),
  };
}


