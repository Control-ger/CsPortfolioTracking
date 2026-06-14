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
  const values = Array.isArray(row?.sourceInvestmentIds) ? row.sourceInvestmentIds : [];
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

  const rawById = new Map();
  (Array.isArray(rawInvestments) ? rawInvestments : []).forEach((item) => {
    const itemId = normalizeInvestmentId(item?.id);
    if (!itemId) {
      return;
    }
    rawById.set(itemId, item);
  });

  const clusterRows = Array.isArray(clusteredInvestments) ? clusteredInvestments : [];
  const clusterBySourceInvestmentId = new Map();
  clusterRows.forEach((clusterRow) => {
    resolveClusterRowSourceIds(clusterRow).forEach((investmentId) => {
      if (!clusterBySourceInvestmentId.has(investmentId)) {
        clusterBySourceInvestmentId.set(investmentId, clusterRow);
      }
    });
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
