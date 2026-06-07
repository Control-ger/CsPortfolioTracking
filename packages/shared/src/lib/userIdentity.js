const MAX_INT32 = 2_147_483_647;
const STEAM_ID_PATTERN = /^[1-9]\d{10,}$/;
const DESKTOP_STEAM_USER_ID_PATTERN = /^steam-([1-9]\d{10,})$/i;

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
  const raw = candidate === null || candidate === undefined ? "" : String(candidate).trim();
  if (!raw) {
    return fallbackId;
  }

  const steamPrefixedMatch = raw.match(DESKTOP_STEAM_USER_ID_PATTERN);
  if (steamPrefixedMatch) {
    return `steam-${steamPrefixedMatch[1]}`;
  }

  if (STEAM_ID_PATTERN.test(raw)) {
    return `steam-${raw}`;
  }

  const parsed = parsePositiveUserId(candidate);
  if (parsed === null) {
    return fallbackId;
  }
  return String(parsed);
}

export function resolveDesktopLocalUserId(user, fallback = 1) {
  const candidate = user?.steamId
    ? `steam-${user.steamId}`
    : user?.localUserId ?? user?.userId ?? user?.id ?? fallback;
  return normalizeDesktopLocalUserId(candidate, String(fallback || 1));
}

export function parseDesktopSyncUserId(user) {
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
  // Those are not valid server user IDs and must be resolved server-side by steamId.
  const numericCandidateRaw = String(user?.id || user?.userId || "").trim();
  if (STEAM_ID_PATTERN.test(numericCandidateRaw)) {
    return null;
  }

  const fallbackRaw = String(user?.id || user?.userId || "").trim().toLowerCase();
  if (fallbackRaw.startsWith("steam-") || String(user?.steamId || "").trim() !== "") {
    return null;
  }

  return null;
}
