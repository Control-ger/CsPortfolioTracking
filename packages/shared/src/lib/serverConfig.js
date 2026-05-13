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

