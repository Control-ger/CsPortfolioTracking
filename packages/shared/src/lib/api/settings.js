import {
  request,
  requestWithMeta,
  getDesktopSecrets,
} from "./core.js";

export async function fetchExchangeRate() {
  return request("/api/v1/exchange-rate");
}

export async function fetchFeeSettings() {
  return requestWithMeta("/api/v1/settings/fees");
}

export async function updateFeeSettings(payload) {
  return requestWithMeta("/api/v1/settings/fees", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchPriceSourcePreference() {
  return requestWithMeta("/api/v1/settings/price-source");
}

export async function updatePriceSourcePreference(mode) {
  return requestWithMeta("/api/v1/settings/price-source", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

export async function fetchCurrencyPreference() {
  return requestWithMeta("/api/v1/settings/currency");
}

export async function updateCurrencyPreference(currency) {
  return requestWithMeta("/api/v1/settings/currency", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currency }),
  });
}

export async function fetchPortfolioGroupsSetting() {
  return requestWithMeta("/api/v1/settings/portfolio-groups");
}

export async function updatePortfolioGroupsSetting(groups = []) {
  return requestWithMeta("/api/v1/settings/portfolio-groups", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      groups: Array.isArray(groups) ? groups : [],
    }),
  });
}

export async function fetchCsFloatApiKeyStatus() {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.getCsFloatApiKeyStatus) {
    return {
      data: await desktopSecrets.getCsFloatApiKeyStatus(),
      meta: {
        source: "desktop-local",
      },
    };
  }

  return { data: { configured: false, hasKey: false }, meta: { source: "web-unavailable" } };
}

export async function updateCsFloatApiKey(apiKeyOrEncryptedKey) {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.setCsFloatApiKey) {
    const result = await desktopSecrets.setCsFloatApiKey(apiKeyOrEncryptedKey);

    return {
      data: result?.status || result,
      meta: {
        source: "desktop-safe-storage",
      },
    };
  }

  throw new Error("CSFloat API Key updates are only supported in the Desktop app.");
}

export async function fetchSkinBaronApiKeyStatus() {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.getSkinBaronSessionStatus) {
    return {
      data: await desktopSecrets.getSkinBaronSessionStatus(),
      meta: {
        source: "desktop-local",
      },
    };
  }

  if (desktopSecrets?.getSkinBaronApiKeyStatus) {
    return {
      data: await desktopSecrets.getSkinBaronApiKeyStatus(),
      meta: {
        source: "desktop-local",
      },
    };
  }

  return {
    data: { configured: false, sessionCookieConfigured: false, importReady: false },
    meta: { source: "web-unavailable" },
  };
}

export async function updateSkinBaronApiKey(apiKeyOrEncryptedKey) {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.setSkinBaronApiKey) {
    const result = await desktopSecrets.setSkinBaronApiKey(apiKeyOrEncryptedKey);

    return {
      data: result?.status || result,
      meta: {
        source: "desktop-safe-storage",
      },
    };
  }

  throw new Error("SkinBaron API Key updates are only supported in the Desktop app.");
}

export async function updateSkinBaronSessionCookie(sessionCookie) {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.setSkinBaronSessionCookie) {
    const result = await desktopSecrets.setSkinBaronSessionCookie(sessionCookie);

    return {
      data: result?.status || result,
      meta: {
        source: "desktop-safe-storage",
      },
    };
  }

  throw new Error("SkinBaron Session-Cookie updates are only supported in the Desktop app.");
}

export async function connectSkinBaronSessionCookieViaBrowser() {
  const desktopSecrets = getDesktopSecrets();
  if (desktopSecrets?.connectSkinBaronSessionCookieViaBrowser) {
    const result = await desktopSecrets.connectSkinBaronSessionCookieViaBrowser();
    if (!result?.ok) {
      throw new Error(result?.error || "SkinBaron Login konnte nicht abgeschlossen werden.");
    }

    return {
      data: result?.status || result,
      meta: {
        source: "desktop-safe-storage",
      },
    };
  }

  throw new Error("SkinBaron Browser-Login ist nur in der Desktop-App verfuegbar.");
}

export async function fetchWebPushPublicKey() {
  return requestWithMeta("/api/v1/push/public-key");
}

export async function subscribeWebPush(subscription, userId = 1) {
  return requestWithMeta("/api/v1/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      subscription,
    }),
  });
}

export async function unsubscribeWebPush(endpoint, userId = 1) {
  return requestWithMeta("/api/v1/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      endpoint,
    }),
  });
}
