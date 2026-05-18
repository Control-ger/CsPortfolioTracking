const MAX_INT32 = 2_147_483_647;

function parsePositiveUserId(candidate) {
  const raw = candidate === null || candidate === undefined ? "" : String(candidate).trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_INT32) {
    return null;
  }

  return Math.floor(parsed);
}

export function normalizeDesktopLocalUserId(candidate, fallback = "1") {
  const fallbackId = String(fallback || "1").trim() || "1";
  const parsed = parsePositiveUserId(candidate);
  if (parsed === null) {
    return fallbackId;
  }
  return String(parsed);
}

export function resolveDesktopLocalUserId(user, fallback = 1) {
  const candidate = user?.userId ?? user?.id ?? fallback;
  return normalizeDesktopLocalUserId(candidate, String(fallback || 1));
}

export function parseDesktopSyncUserId(user, fallback = 1) {
  const candidates = [
    user?.userId,
    user?.localUserId,
    user?.serverUserId,
    user?.id,
  ];

  for (const candidate of candidates) {
    const parsed = parsePositiveUserId(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  // Legacy desktop sessions may carry Steam IDs as large numeric "id" values.
  // Sync is still keyed to the default numeric user scope.
  const numericCandidateRaw = String(user?.id || user?.userId || "").trim();
  if (/^[1-9]\d{10,}$/.test(numericCandidateRaw)) {
    const normalizedFallback = parsePositiveUserId(fallback);
    return normalizedFallback ?? 1;
  }

  const fallbackRaw = String(user?.id || user?.userId || "").trim().toLowerCase();
  if (fallbackRaw.startsWith("steam-") || String(user?.steamId || "").trim() !== "") {
    // Desktop auth sessions can use "steam-<steamId>" identifiers.
    // Sync endpoints still expect a positive integer userId (legacy/default scope).
    const normalizedFallback = parsePositiveUserId(fallback);
    return normalizedFallback ?? 1;
  }

  return null;
}
