export const DEFAULT_FORM = {
  fxFeePercent: "0",
  sellerFeePercent: "2",
  withdrawalFeePercent: "2.5",
  depositFeePercent: "2.8",
  depositFeeFixedEur: "0.26",
};

export function toInputValue(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return String(value);
}

export function formatExchangeRate(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(4) : "-";
}

export function isDesktopRuntime() {
  return typeof window !== "undefined" && Boolean(window.electronAPI?.secrets);
}

export function normalizePriceSourceMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "csfloat") {
    return "csfloat";
  }
  if (normalized === "steam") {
    return "steam";
  }
  return "auto";
}

export function normalizeSkinBaronStatusPayload(statusPayload) {
  const nextStatus = statusPayload && typeof statusPayload === "object" ? statusPayload : {};
  return {
    configured: Boolean(nextStatus?.configured || nextStatus?.hasKey),
    lastFour: nextStatus?.lastFour || null,
    capabilities:
      nextStatus?.capabilities && typeof nextStatus.capabilities === "object"
        ? nextStatus.capabilities
        : {},
    checkedAt: nextStatus?.checkedAt || null,
    sessionCookieConfigured: Boolean(nextStatus?.sessionCookieConfigured),
    sessionCookieHasAuthId: Boolean(nextStatus?.sessionCookieHasAuthId),
    sessionCookieLastFour: nextStatus?.sessionCookieLastFour || null,
    sessionCookieCheckedAt: nextStatus?.sessionCookieCheckedAt || null,
    sessionCookieAccess:
      nextStatus?.sessionCookieAccess && typeof nextStatus.sessionCookieAccess === "object"
        ? nextStatus.sessionCookieAccess
        : { allowed: false, statusCode: null, message: null },
    importReady: Boolean(nextStatus?.importReady),
  };
}

export function base64UrlToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = `${base64Url}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
