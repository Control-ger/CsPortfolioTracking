const GROUP_MEMBER_LIMIT = 5000;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

export function normalizeInvestmentId(value) {
  const normalized = normalizeText(value);
  return normalized === "" ? "" : normalized;
}

export function uniqueInvestmentIds(values = []) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const normalized = normalizeInvestmentId(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });

  return result.slice(0, GROUP_MEMBER_LIMIT);
}

function normalizeTimestamp(value, fallback) {
  const normalized = normalizeText(value);
  return normalized || fallback;
}

function toPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildGroupId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `group-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function resolveClusterRowKey(row) {
  return normalizeLowerText(row?.id || row?.marketHashName || row?.name || row?.itemName);
}

function resolveClusterRowSourceIds(row) {
  const values = [
    ...(Array.isArray(row?.sourceInvestmentIds) ? row.sourceInvestmentIds : []),
    // Server-aggregated rows carry desktop-local ids index-aligned in
    // sourceClientIds; both namespaces are valid membership keys.
    ...(Array.isArray(row?.sourceClientIds) ? row.sourceClientIds : []),
  ];
  return uniqueInvestmentIds(values);
}

function resolveClusterUnitCurrentValue(clusterRow, fallbackQuantity = 1) {
  const clusterQuantity = Math.max(1, toPositiveNumber(clusterRow?.quantity, fallbackQuantity));
  const clusterCurrentValue = Number(clusterRow?.currentValue);
  if (Number.isFinite(clusterCurrentValue)) {
    return clusterCurrentValue / clusterQuantity;
  }

  const clusterDisplayPrice = Number(clusterRow?.displayPrice ?? clusterRow?.livePrice);
  if (Number.isFinite(clusterDisplayPrice)) {
    return clusterDisplayPrice;
  }

  return 0;
}

function createEmptyClusterAggregate({ clusterKey, clusterRow, rawItem }) {
  return {
    id: normalizeText(clusterRow?.id || clusterKey || rawItem?.id || rawItem?.name),
    // Numeric catalog item id — needed to fetch per-member price history for the
    // group's weighted value-over-time chart. First non-zero member id wins.
    itemId: Number(clusterRow?.itemId ?? clusterRow?.item_id ?? rawItem?.itemId ?? rawItem?.item_id ?? 0) || 0,
    clusterKey,
    sourceInvestmentIds: [],
    name:
      normalizeText(clusterRow?.name || clusterRow?.marketHashName || rawItem?.name || rawItem?.marketHashName) ||
      "Unbekanntes Cluster",
    imageUrl: clusterRow?.imageUrl || rawItem?.imageUrl || rawItem?.iconUrl || null,
    quantity: 0,
    totalInvested: 0,
    totalValue: 0,
    currentUnitPrice: 0,
    isLive: Boolean(clusterRow?.isLive),
    freshnessLabel: clusterRow?.freshnessLabel || null,
    memberCount: 0,
  };
}

function finalizeClusterAggregate(cluster) {
  const quantity = Math.max(0, toFiniteNumber(cluster.quantity, 0));
  const totalInvested = toFiniteNumber(cluster.totalInvested, 0);
  const totalValue = toFiniteNumber(cluster.totalValue, 0);
  const roiPercent = totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0;

  return {
    ...cluster,
    quantity,
    totalInvested,
    totalValue,
    roiPercent,
    sharePercent: 0,
    currentUnitPrice: quantity > 0 ? totalValue / quantity : toFiniteNumber(cluster.currentUnitPrice, 0),
    buyUnitPrice: quantity > 0 ? totalInvested / quantity : 0,
  };
}

export const PORTFOLIO_GROUPS_STORAGE_KEY = "portfolio:groups:v1";

/**
 * Per-user local cache key for portfolio groups. The legacy
 * `PORTFOLIO_GROUPS_STORAGE_KEY` is a single global slot, so switching Steam
 * accounts on the same machine would let two users clobber each other's cached
 * groups. Scope the key by the resolved local user id; callers migrate the
 * legacy global key into the scoped one once (see PortfolioPage load).
 */
export function portfolioGroupsStorageKey(userId) {
  const scope = String(userId ?? "").trim();
  return scope ? `${PORTFOLIO_GROUPS_STORAGE_KEY}:user:${scope}` : PORTFOLIO_GROUPS_STORAGE_KEY;
}

export function createPortfolioGroupDraft() {
  return {
    id: "",
    name: "",
    thesis: "",
  };
}

export function normalizePortfolioGroups(input) {
  const rows = Array.isArray(input)
    ? input
    : Array.isArray(input?.groups)
      ? input.groups
      : [];

  return rows
    .map((group) => {
      const createdAt = normalizeTimestamp(group?.createdAt, new Date().toISOString());
      const updatedAt = normalizeTimestamp(group?.updatedAt, createdAt);
      return {
        id: normalizeText(group?.id) || buildGroupId(),
        name: normalizeText(group?.name),
        thesis: normalizeText(group?.thesis),
        memberInvestmentIds: uniqueInvestmentIds(group?.memberInvestmentIds),
        createdAt,
        updatedAt,
      };
    })
    .filter((group) => group.name !== "");
}

/**
 * Merge locally-cached groups with the server's set without losing either side.
 *
 * The previous load strategy was "server wins wholesale if it has any groups",
 * which silently dropped a group that only ever reached the local cache (e.g.
 * created while upstream was unreachable and the sidecar returned a
 * desktop-local-fallback success). Here we union by `id` and let the newer
 * `updatedAt` win on conflicts, so a local-only / locally-newer group survives a
 * reload and can be pushed back up.
 *
 * Known limitation: there are no tombstones, so a deletion that never reached the
 * server is undone on the next merge (the group reappears). Resurrecting a group
 * is far less harmful than silently losing one; proper delete-sync would need an
 * operations_log-style tombstone like investments/watchlist.
 */
export function mergePortfolioGroups(localGroups = [], remoteGroups = []) {
  const byId = new Map();

  const consider = (group) => {
    const existing = byId.get(group.id);
    if (!existing) {
      byId.set(group.id, group);
      return;
    }
    const existingAt = Date.parse(existing.updatedAt) || 0;
    const candidateAt = Date.parse(group.updatedAt) || 0;
    if (candidateAt >= existingAt) {
      byId.set(group.id, group);
    }
  };

  normalizePortfolioGroups(remoteGroups).forEach(consider);
  normalizePortfolioGroups(localGroups).forEach(consider);

  return Array.from(byId.values()).sort((left, right) => {
    const leftAt = Date.parse(left.createdAt) || 0;
    const rightAt = Date.parse(right.createdAt) || 0;
    return leftAt - rightAt || left.name.localeCompare(right.name, "de");
  });
}

/**
 * Stable content signature for a group set — used to decide whether a merged set
 * carries anything the server does not already have (and thus needs a push-up).
 */
export function portfolioGroupsSignature(groups = []) {
  return normalizePortfolioGroups(groups)
    .map((group) => `${group.id}:${group.updatedAt}:${group.memberInvestmentIds.length}`)
    .sort()
    .join("|");
}

export function buildPortfolioGroupMembershipMap(groups = []) {
  const membership = new Map();

  normalizePortfolioGroups(groups).forEach((group) => {
    group.memberInvestmentIds.forEach((investmentId) => {
      membership.set(investmentId, group.id);
    });
  });

  return membership;
}

export function buildPortfolioGroupSummaries({
  groups = [],
  clusteredInvestments = [],
  rawInvestments = [],
} = {}) {
  const normalizedGroups = normalizePortfolioGroups(groups);
  if (normalizedGroups.length === 0) {
    return [];
  }

  // Membership ids can come from either runtime: desktop groups store local ids
  // (csfloat-…, steam asset ids), web groups store server ids. Index every row
  // under all of its id aliases so a group resolves regardless of where it was
  // created and where it is rendered.
  const resolveRowIdAliases = (row) =>
    uniqueInvestmentIds([row?.id, row?.clientId, row?.serverId]);

  const registerAlias = (map, key, value) => {
    const normalized = normalizeInvestmentId(key);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, value);
    }
  };

  const rawById = new Map();
  (Array.isArray(rawInvestments) ? rawInvestments : []).forEach((item) => {
    resolveRowIdAliases(item).forEach((alias) => registerAlias(rawById, alias, item));
  });

  const clusterRows = Array.isArray(clusteredInvestments) ? clusteredInvestments : [];
  const clusterBySourceInvestmentId = new Map();
  clusterRows.forEach((clusterRow) => {
    const sourceIds = resolveClusterRowSourceIds(clusterRow);
    sourceIds.forEach((investmentId) => {
      registerAlias(clusterBySourceInvestmentId, investmentId, clusterRow);
      const rawItem = rawById.get(investmentId);
      if (rawItem) {
        resolveRowIdAliases(rawItem).forEach((alias) =>
          registerAlias(clusterBySourceInvestmentId, alias, clusterRow),
        );
      }
    });
    // Server-aggregated web rows carry their own id/clientId instead of
    // sourceInvestmentIds from local clustering.
    resolveRowIdAliases(clusterRow).forEach((alias) =>
      registerAlias(clusterBySourceInvestmentId, alias, clusterRow),
    );
  });

  return normalizedGroups
    .map((group) => {
      const clusters = new Map();
      const liveClusterKeys = new Set();
      const fallbackClusterKeysHandled = new Set();
      const presentMemberIds = [];
      let totalQuantity = 0;
      let totalInvested = 0;
      let totalValue = 0;
      let inventoryMemberCount = 0;

      group.memberInvestmentIds.forEach((investmentId) => {
        const rawItem = rawById.get(investmentId) || null;
        const clusterRow = clusterBySourceInvestmentId.get(investmentId) || null;

        if (!rawItem && !clusterRow) {
          return;
        }

        const clusterKey = resolveClusterRowKey(clusterRow || rawItem);
        if (!rawItem && clusterRow) {
          if (fallbackClusterKeysHandled.has(clusterKey)) {
            return;
          }
          fallbackClusterKeysHandled.add(clusterKey);
        }

        presentMemberIds.push(investmentId);
        if (String(rawItem?.bucket || clusterRow?.bucket || "").toLowerCase() === "inventory") {
          inventoryMemberCount += 1;
        }

        const rawQuantity = Math.max(
          1,
          toPositiveNumber(rawItem?.quantity, toPositiveNumber(clusterRow?.quantity, 1)),
        );
        const buyUnitPrice = toFiniteNumber(
          rawItem?.buyPriceUsd ?? rawItem?.buyPrice,
          toFiniteNumber(clusterRow?.buyPriceUsd ?? clusterRow?.buyPrice, 0),
        );
        const invested = buyUnitPrice * rawQuantity;
        const currentUnitPrice = resolveClusterUnitCurrentValue(clusterRow, rawQuantity);
        const currentValue = currentUnitPrice * rawQuantity;

        if (!clusters.has(clusterKey)) {
          clusters.set(
            clusterKey,
            createEmptyClusterAggregate({
              clusterKey,
              clusterRow,
              rawItem,
            }),
          );
        }

        const aggregate = clusters.get(clusterKey);
        aggregate.quantity += rawQuantity;
        aggregate.totalInvested += invested;
        aggregate.totalValue += currentValue;
        aggregate.memberCount += 1;
        aggregate.sourceInvestmentIds.push(investmentId);
        if (!aggregate.imageUrl) {
          aggregate.imageUrl = clusterRow?.imageUrl || rawItem?.imageUrl || rawItem?.iconUrl || null;
        }
        if (!aggregate.currentUnitPrice && currentUnitPrice > 0) {
          aggregate.currentUnitPrice = currentUnitPrice;
        }
        if (!aggregate.itemId) {
          const memberItemId = Number(
            clusterRow?.itemId ?? clusterRow?.item_id ?? rawItem?.itemId ?? rawItem?.item_id ?? 0,
          );
          if (Number.isFinite(memberItemId) && memberItemId > 0) {
            aggregate.itemId = memberItemId;
          }
        }
        if (clusterRow?.isLive) {
          aggregate.isLive = true;
          liveClusterKeys.add(clusterKey);
        }
        if (!aggregate.freshnessLabel && clusterRow?.freshnessLabel) {
          aggregate.freshnessLabel = clusterRow.freshnessLabel;
        }

        totalQuantity += rawQuantity;
        totalInvested += invested;
        totalValue += currentValue;
      });

      const clusterRowsForGroup = Array.from(clusters.values())
        .map(finalizeClusterAggregate)
        .sort((left, right) => right.totalValue - left.totalValue || left.name.localeCompare(right.name, "de"))
        .map((cluster) => ({
          ...cluster,
          sharePercent: totalValue > 0 ? (cluster.totalValue / totalValue) * 100 : 0,
        }));

      if (presentMemberIds.length === 0 || clusterRowsForGroup.length === 0) {
        return null;
      }

      const totalProfit = totalValue - totalInvested;
      const roiPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
      const weightedCurrentUnitPrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
      const weightedBuyUnitPrice = totalQuantity > 0 ? totalInvested / totalQuantity : 0;
      const topVisuals = clusterRowsForGroup.slice(0, 2).map((cluster) => ({
        id: cluster.id,
        name: cluster.name,
        imageUrl: cluster.imageUrl || null,
        sharePercent: cluster.sharePercent,
      }));

      return {
        ...group,
        memberInvestmentIds: presentMemberIds,
        // Dominant bucket of the resolved members: only when EVERY member sits in
        // the inventory bucket does the group count as inventory; mixed groups are
        // treated as investments (matching the single-row default).
        bucket:
          presentMemberIds.length > 0 && inventoryMemberCount === presentMemberIds.length
            ? "inventory"
            : "investment",
        totalQuantity,
        totalInvested,
        totalValue,
        totalProfit,
        roiPercent,
        weightedCurrentUnitPrice,
        weightedBuyUnitPrice,
        clusterCount: clusterRowsForGroup.length,
        memberCount: presentMemberIds.length,
        liveClusterCount: liveClusterKeys.size,
        topVisuals,
        clusters: clusterRowsForGroup,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.totalValue - left.totalValue || left.name.localeCompare(right.name, "de"));
}

/**
 * Reduce a price-history entry's date to a UTC day bucket (YYYY-MM-DD).
 * PortfolioChart.parseDateToTimestamp already understands this format.
 */
function toDayBucket(dateValue) {
  const raw = normalizeText(dateValue);
  if (!raw) {
    return "";
  }
  // Fast path: already starts with YYYY-MM-DD (ISO date or "YYYY-MM-DD HH:MM:SS").
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (match) {
    return match[1];
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

/**
 * Collapse a member's raw price history into a sorted, de-duplicated series of
 * daily USD unit prices. Last value per day wins.
 * Input entries: { date, priceUsd } (priceUsd falls back to price_usd).
 */
function normalizeMemberDailySeries(history) {
  const perDay = new Map();
  (Array.isArray(history) ? history : []).forEach((entry) => {
    const day = toDayBucket(entry?.date);
    if (!day) {
      return;
    }
    const priceUsd = Number(entry?.priceUsd ?? entry?.price_usd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      return;
    }
    perDay.set(day, priceUsd); // later entries override earlier same-day ones
  });
  return Array.from(perDay.entries())
    .map(([day, priceUsd]) => ({ day, priceUsd }))
    .sort((left, right) => (left.day < right.day ? -1 : left.day > right.day ? 1 : 0));
}

/**
 * Build a weighted total-value-over-time series for a portfolio group, valuing the
 * CURRENT basket (fixed quantity per cluster) at historical daily prices:
 *   value(day) = Σ quantity_i × unitPriceUsd_i(day)
 *
 * Gap handling ("common overlap"): the series starts only once EVERY member has
 * price data (latest first-day among members) and each member's price is
 * forward-filled (last known ≤ bucket) within the window.
 *
 * @param {Array<{ itemId:number, quantity:number, history:Array<{date,priceUsd}> }>} members
 * @returns {Array<{ date: string, priceUsd: number }>} ascending by date; USD.
 */
export function buildWeightedGroupHistory(members) {
  const prepared = (Array.isArray(members) ? members : [])
    .map((member) => ({
      quantity: Math.max(0, toFiniteNumber(member?.quantity, 0)),
      series: normalizeMemberDailySeries(member?.history),
    }))
    .filter((member) => member.quantity > 0 && member.series.length > 0);

  if (prepared.length === 0) {
    return [];
  }

  // Common-overlap start = the latest first-day across members; end = latest last-day.
  const startDay = prepared
    .map((member) => member.series[0].day)
    .reduce((max, day) => (day > max ? day : max));
  const endDay = prepared
    .map((member) => member.series[member.series.length - 1].day)
    .reduce((max, day) => (day > max ? day : max));

  // Union of real buckets within [startDay, endDay] keeps the point count bounded.
  const bucketSet = new Set();
  prepared.forEach((member) => {
    member.series.forEach(({ day }) => {
      if (day >= startDay && day <= endDay) {
        bucketSet.add(day);
      }
    });
  });
  const buckets = Array.from(bucketSet).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (buckets.length === 0) {
    return [];
  }

  // Forward-fill each member across the buckets via an advancing cursor.
  const cursors = prepared.map(() => 0);
  return buckets.map((day) => {
    let total = 0;
    prepared.forEach((member, index) => {
      const series = member.series;
      let cursor = cursors[index];
      while (cursor + 1 < series.length && series[cursor + 1].day <= day) {
        cursor += 1;
      }
      cursors[index] = cursor;
      // At/after startDay every member has a value ≤ day by construction.
      total += member.quantity * series[cursor].priceUsd;
    });
    return { date: day, priceUsd: total };
  });
}

export function summarizeManagementClusterAssignment(cluster, membershipMap, groupsById) {
  const sourceIds = uniqueInvestmentIds(
    Array.isArray(cluster?.positions) ? cluster.positions.map((position) => position?.id) : [],
  );
  if (sourceIds.length === 0) {
    return {
      assignmentState: "empty",
      assignedGroupId: "",
      assignedGroupName: "",
      assignedCount: 0,
      totalCount: 0,
    };
  }

  const assignedGroupIds = new Set();
  let assignedCount = 0;
  sourceIds.forEach((investmentId) => {
    const groupId = membershipMap.get(investmentId);
    if (!groupId) {
      return;
    }
    assignedCount += 1;
    assignedGroupIds.add(groupId);
  });

  if (assignedCount === 0) {
    return {
      assignmentState: "ungrouped",
      assignedGroupId: "",
      assignedGroupName: "",
      assignedCount,
      totalCount: sourceIds.length,
    };
  }

  if (assignedGroupIds.size === 1 && assignedCount === sourceIds.length) {
    const assignedGroupId = Array.from(assignedGroupIds)[0];
    return {
      assignmentState: "grouped",
      assignedGroupId,
      assignedGroupName: groupsById.get(assignedGroupId)?.name || "",
      assignedCount,
      totalCount: sourceIds.length,
    };
  }

  return {
    assignmentState: "partial",
    assignedGroupId: "",
    assignedGroupName: "",
    assignedCount,
    totalCount: sourceIds.length,
  };
}
