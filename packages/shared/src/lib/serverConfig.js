const HOST_PATTERN =
  /^(localhost|(\d{1,3}\.){3}\d{1,3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(:\d{1,5})?$/i;

function parseHostFromUrlLikeInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const withScheme = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : "";
  if (!withScheme) {
    return "";
  }

  try {
    const parsed = new URL(withScheme);
    const host = parsed.hostname || "";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${host}${port}`;
  } catch {
    return "";
  }
}

export function ensureServerUrlScheme(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function normalizeServerBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return "";
  }

  let end = trimmed.length;
  while (end > 0 && trimmed.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  const withoutTrailingSlash = end === trimmed.length ? trimmed : trimmed.slice(0, end);
  // A stored host-only value (e.g. "cs2.example.cc") must become an absolute
  // URL, otherwise renderer fetches resolve relative to file:// and fail with
  // ERR_FILE_NOT_FOUND, and curl in the sidecar rejects the scheme-less URL.
  return ensureServerUrlScheme(withoutTrailingSlash);
}

export function resolveAccessBaseUrl(serverBaseUrl) {
  const normalized = normalizeServerBaseUrl(serverBaseUrl);
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

export function normalizeServerHostInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const fromUrl = parseHostFromUrlLikeInput(trimmed);
  let candidate = fromUrl || trimmed;
  candidate = candidate.replace(/\\/g, "/");

  if (!fromUrl) {
    candidate = candidate.split(/[/?#]/, 1)[0] || "";
    const atIndex = candidate.lastIndexOf("@");
    if (atIndex >= 0) {
      candidate = candidate.slice(atIndex + 1);
    }
  }

  candidate = candidate.trim().replace(/^\[|\]$/g, "");
  if (!candidate) {
    return "";
  }

  if (!HOST_PATTERN.test(candidate)) {
    return "";
  }

  return candidate.toLowerCase();
}
