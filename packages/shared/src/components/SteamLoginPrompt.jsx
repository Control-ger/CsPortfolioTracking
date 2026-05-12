import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  devModeLogin,
  getCurrentUser,
  getSession,
  initiateSteamLogin,
  isAuthenticated,
  validateSession,
} from "../lib/auth.js";
import { fetchPortfolioData } from "@shared/lib/dataSource.js";

function formatSteamInventoryError(error) {
  const raw = String(error?.message || error || "");
  const upper = raw.toUpperCase();
  if (upper.includes("INVENTORY_ACCESS_DENIED")) {
    return "Steam-Inventar ist nicht oeffentlich erreichbar. Stelle in Steam Profil und Inventar auf oeffentlich und versuche es erneut.";
  }
  if (upper.includes("RATE") || upper.includes("429")) {
    return "Steam hat den Zugriff temporaer begrenzt. Bitte in einigen Minuten erneut versuchen.";
  }
  if (upper.includes("INVALID RESPONSE") || upper.includes("JSON")) {
    return "Steam hat keine gueltige Inventarantwort geliefert. Bitte spaeter erneut versuchen.";
  }
  return raw || "Steam-Inventar konnte nicht importiert werden.";
}

function stableHash(value) {
  const input = String(value || "");
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

function resolveSteamPalette(user) {
  const seedSource = user?.steamId || user?.avatar || user?.name || "steam";
  const base = stableHash(seedSource);
  const hueA = base % 360;
  const hueB = (hueA + 42 + (base % 37)) % 360;
  const hueC = (hueA + 210 + (base % 59)) % 360;
  return {
    colorA: `hsla(${hueA}, 78%, 56%, 0.16)`,
    colorB: `hsla(${hueB}, 80%, 60%, 0.12)`,
    colorC: `hsla(${hueC}, 74%, 52%, 0.10)`,
  };
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") {
        return trimmed;
      }
    }
  }
  return null;
}

function normalizeAvatarUrl(url) {
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (trimmed === "") {
    return null;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith("/")) {
    return `https://steamcommunity.com${trimmed}`;
  }
  if (trimmed.startsWith("http://")) {
    return `https://${trimmed.slice("http://".length)}`;
  }
  return trimmed;
}

function resolveAvatarUrls(user) {
  const animatedAvatarUrl = normalizeAvatarUrl(
    firstNonEmptyString(
      user?.animatedAvatar,
      user?.animated_avatar,
      user?.animatedAvatarUrl,
      user?.animated_avatar_url,
    ),
  );
  const staticAvatarUrl = normalizeAvatarUrl(
    firstNonEmptyString(
      user?.avatar,
      user?.steam_avatar,
      user?.steamAvatar,
      user?.avatarUrl,
      user?.avatar_url,
    ),
  );

  return {
    animatedAvatarUrl,
    staticAvatarUrl,
    preferredAvatarUrl: animatedAvatarUrl || staticAvatarUrl,
  };
}

function hasNoAvatarData(user) {
  const { animatedAvatarUrl, staticAvatarUrl } = resolveAvatarUrls(user);
  return !animatedAvatarUrl && !staticAvatarUrl;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsl(r, g, b) {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === nr) {
      h = ((ng - nb) / delta) % 6;
    } else if (max === ng) {
      h = (nb - nr) / delta + 2;
    } else {
      h = (nr - ng) / delta + 4;
    }
  }
  h = Math.round(h * 60);
  if (h < 0) {
    h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return {
    h,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function toHslaString(hsl, alpha) {
  return `hsla(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%, ${alpha})`;
}

function tuneHsl(hsl, index) {
  const saturationBoost = index === 0 ? 1.12 : index === 1 ? 1.08 : 1.02;
  const lightnessShift = index === 0 ? 2 : index === 1 ? -1 : -5;
  return {
    h: hsl.h,
    s: clamp(Math.round(hsl.s * saturationBoost), 34, 76),
    l: clamp(hsl.l + lightnessShift, 24, 66),
  };
}

function complementaryHsl(hsl) {
  return {
    h: (Math.round(hsl.h) + 180) % 360,
    s: clamp(Math.round(hsl.s * 0.88), 28, 68),
    l: clamp(Math.round(hsl.l * 0.92), 20, 62),
  };
}

function isVideoAvatarUrl(url) {
  const lower = String(url || "").toLowerCase();
  return (
    lower.endsWith(".webm") ||
    lower.endsWith(".mp4") ||
    lower.includes(".webm?") ||
    lower.includes(".mp4?")
  );
}

function isGifAvatarUrl(url) {
  const lower = String(url || "").toLowerCase();
  return lower.endsWith(".gif") || lower.includes(".gif?");
}

function resolveAvatarRenderMode(url) {
  if (!url) {
    return "none";
  }
  if (isVideoAvatarUrl(url)) {
    return "video";
  }
  if (isGifAvatarUrl(url)) {
    return "gif";
  }
  return "img";
}

async function inspectGifAnimation(url) {
  if (!url || typeof window === "undefined") {
    return null;
  }
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { ok: false, status: response.status, reason: "http_error" };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const header = String.fromCharCode(...bytes.slice(0, 6));
    const isGif = header === "GIF87a" || header === "GIF89a";
    if (!isGif) {
      return { ok: true, isGif: false, frameDescriptors: 0, loopExtension: false };
    }

    let frameDescriptors = 0;
    let loopExtension = false;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] === 0x2c) {
        frameDescriptors += 1;
      }
      if (
        bytes[index] === 0x21 &&
        bytes[index + 1] === 0xff &&
        bytes[index + 2] === 0x0b &&
        index + 14 < bytes.length
      ) {
        const label = String.fromCharCode(...bytes.slice(index + 3, index + 14));
        if (label === "NETSCAPE2.0" || label === "ANIMEXTS1.0") {
          loopExtension = true;
        }
      }
    }

    return {
      ok: true,
      isGif: true,
      frameDescriptors,
      loopExtension,
      likelyAnimated: frameDescriptors > 1 || loopExtension,
      contentType: response.headers.get("content-type") || "",
      contentLength: response.headers.get("content-length") || "",
    };
  } catch (error) {
    return {
      ok: false,
      reason: "fetch_failed",
      error: String(error?.message || error || "unknown"),
    };
  }
}

async function extractPaletteFromImage(imageUrl, fallbackPalette) {
  if (typeof window === "undefined" || !imageUrl) {
    return fallbackPalette;
  }

  const image = await new Promise((resolve) => {
    const nextImage = new Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.referrerPolicy = "no-referrer";
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => resolve(null);
    nextImage.src = imageUrl;
  });

  if (!image) {
    return fallbackPalette;
  }

  try {
    const canvas = document.createElement("canvas");
    const size = 40;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return fallbackPalette;
    }

    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;

    const zones = [
      { r: 0, g: 0, b: 0, count: 0 },
      { r: 0, g: 0, b: 0, count: 0 },
      { r: 0, g: 0, b: 0, count: 0 },
    ];

    for (let y = 0; y < size; y += 2) {
      for (let x = 0; x < size; x += 2) {
        const offset = (y * size + x) * 4;
        const alpha = pixels[offset + 3];
        if (alpha < 24) {
          continue;
        }
        const zoneIndex = x < size / 3 ? 0 : x < (2 * size) / 3 ? 1 : 2;
        zones[zoneIndex].r += pixels[offset];
        zones[zoneIndex].g += pixels[offset + 1];
        zones[zoneIndex].b += pixels[offset + 2];
        zones[zoneIndex].count += 1;
      }
    }

    const derived = zones.map((zone, index) => {
      if (zone.count === 0) {
        return null;
      }
      const rgb = {
        r: zone.r / zone.count,
        g: zone.g / zone.count,
        b: zone.b / zone.count,
      };
      const hsl = tuneHsl(rgbToHsl(rgb.r, rgb.g, rgb.b), index);
      return hsl;
    });

    if (!derived[0] || !derived[1] || !derived[2]) {
      return fallbackPalette;
    }

    return {
      colorA: toHslaString(derived[0], 0.20),
      colorB: toHslaString(derived[1], 0.16),
      colorC: toHslaString(derived[2], 0.13),
      colorD: toHslaString(complementaryHsl(derived[0]), 0.11),
    };
  } catch {
    return fallbackPalette;
  }
}

export function SteamLoginPrompt({ onLoginSuccess }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [syncInfo, setSyncInfo] = useState("");
  const [steamPalette, setSteamPalette] = useState(() => resolveSteamPalette(null));
  const [isDashboardReady, setIsDashboardReady] = useState(false);
  const [setupProgress, setSetupProgress] = useState({
    total: 1,
    completed: 0,
    currentStep: "",
    inProgress: false,
    done: false,
  });
  const onLoginSuccessRef = useRef(onLoginSuccess);
  const preparationStateRef = useRef({
    key: "",
    running: false,
    finished: false,
  });

  useEffect(() => {
    onLoginSuccessRef.current = onLoginSuccess;
  }, [onLoginSuccess]);

  useEffect(() => {
    if (!user) {
      setSteamPalette(resolveSteamPalette(null));
      return;
    }

    let isActive = true;
    const fallbackPalette = resolveSteamPalette(user);
    setSteamPalette(fallbackPalette);

    const { preferredAvatarUrl, staticAvatarUrl } = resolveAvatarUrls(user);
    const paletteSourceUrl = staticAvatarUrl || (isVideoAvatarUrl(preferredAvatarUrl) ? null : preferredAvatarUrl);
    if (!paletteSourceUrl) {
      return () => {
        isActive = false;
      };
    }

    void extractPaletteFromImage(paletteSourceUrl, fallbackPalette).then((derivedPalette) => {
      if (!isActive) {
        return;
      }
      setSteamPalette(derivedPalette);
    });

    return () => {
      isActive = false;
    };
  }, [
    user?.id,
    user?.steamId,
    user?.name,
    user?.avatar,
    user?.steam_avatar,
    user?.steamAvatar,
    user?.animatedAvatar,
    user?.animated_avatar,
  ]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const { animatedAvatarUrl, staticAvatarUrl, preferredAvatarUrl } = resolveAvatarUrls(user);
    const renderMode = resolveAvatarRenderMode(preferredAvatarUrl);
    console.log("[welcome-avatar] resolved user avatar", {
      steamId: user?.steamId || null,
      animatedAvatarUrl,
      staticAvatarUrl,
      preferredAvatarUrl,
      renderMode,
    });

    if (renderMode !== "gif") {
      return;
    }

    let cancelled = false;
    void inspectGifAnimation(preferredAvatarUrl).then((result) => {
      if (cancelled) {
        return;
      }
      console.log("[welcome-avatar] gif inspection", {
        steamId: user?.steamId || null,
        preferredAvatarUrl,
        inspection: result,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    user?.steamId,
    user?.animatedAvatar,
    user?.animated_avatar,
    user?.avatar,
    user?.steam_avatar,
    user?.steamAvatar,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    root.style.setProperty("--steam-shell-color-a", steamPalette.colorA);
    root.style.setProperty("--steam-shell-color-b", steamPalette.colorB);
    root.style.setProperty("--steam-shell-color-c", steamPalette.colorC);
    root.style.setProperty("--steam-shell-color-d", steamPalette.colorD || steamPalette.colorB);

    return () => {
      root.style.removeProperty("--steam-shell-color-a");
      root.style.removeProperty("--steam-shell-color-b");
      root.style.removeProperty("--steam-shell-color-c");
      root.style.removeProperty("--steam-shell-color-d");
    };
  }, [steamPalette.colorA, steamPalette.colorB, steamPalette.colorC, steamPalette.colorD]);

  const hydrateUserMediaIfNeeded = async (candidateUser) => {
    if (!candidateUser || !hasNoAvatarData(candidateUser)) {
      return candidateUser;
    }

    const session = await getSession();
    if (!session?.token) {
      return candidateUser;
    }

    const refreshed = await validateSession(session.token);
    if (!refreshed?.success || !refreshed.user) {
      return candidateUser;
    }

    const mergedUser = { ...candidateUser, ...refreshed.user };
    try {
      if (window.electronAPI?.storeSession) {
        await window.electronAPI.storeSession(session.token, mergedUser);
      } else {
        sessionStorage.setItem("auth_user", JSON.stringify(mergedUser));
      }
    } catch {
      // Session enrichment should not block the startup flow.
    }

    return mergedUser;
  };

  const markPreparationFailed = (error) => {
    const message = formatSteamInventoryError(error);
    setSyncInfo(`Vorbereitung fehlgeschlagen: ${message}`);
    setError(message);
    setSetupProgress((current) => ({
      ...current,
      inProgress: false,
      done: true,
    }));
    preparationStateRef.current = {
      ...preparationStateRef.current,
      running: false,
      finished: true,
    };
    setIsDashboardReady(true);
  };

  const runPostLoginPreparation = async (currentUser) => {
    const prepKey = String(currentUser?.id || currentUser?.steamId || "unknown");
    if (preparationStateRef.current.running && preparationStateRef.current.key === prepKey) {
      return;
    }
    if (preparationStateRef.current.finished && preparationStateRef.current.key === prepKey) {
      return;
    }
    preparationStateRef.current = {
      key: prepKey,
      running: true,
      finished: false,
    };

    const hasSteamId = Boolean(currentUser?.steamId);
    const steps = hasSteamId
      ? [
          "Steam-Profil pruefen",
          "Steam-Inventar laden",
          "Items lokal importieren",
          "Dashboard-Daten laden",
        ]
      : ["Profil pruefen", "Dashboard-Daten laden"];
    let completed = 0;

    const startStep = (stepLabel) => {
      setSetupProgress({
        total: steps.length,
        completed,
        currentStep: stepLabel,
        inProgress: true,
        done: false,
      });
    };
    const finishStep = (nextStepLabel = "") => {
      completed += 1;
      setSetupProgress({
        total: steps.length,
        completed,
        currentStep: nextStepLabel,
        inProgress: true,
        done: false,
      });
    };

    setIsDashboardReady(false);
    startStep(steps[0]);
    finishStep(steps[1] || "");

    if (hasSteamId) {
      startStep(steps[1]);
      const { fetchCS2Inventory, importInventoryAsInvestments } = await import("../lib/auth.js");
      const inventoryResult = await fetchCS2Inventory(currentUser.steamId);
      finishStep(steps[2]);

      startStep(steps[2]);
      if (inventoryResult.success && inventoryResult.items?.length > 0) {
        const marketableItems = inventoryResult.items.filter((item) => item.marketable);
        if (marketableItems.length > 0) {
          const importResult = await importInventoryAsInvestments(marketableItems, currentUser.id);
          setSyncInfo(
            `Steam Sync: ${importResult.imported || 0} neu, ${importResult.updated || 0} aktualisiert, ${importResult.missingMarked || 0} als fehlend markiert, ${importResult.matchesSuggested || 0} Matching-Vorschlaege.`,
          );
        } else {
          setSyncInfo("Steam Sync: Keine marketable Items im Inventar gefunden.");
        }
      } else if (!inventoryResult.success) {
        throw new Error(inventoryResult.error || "Steam inventory request failed");
      } else {
        setSyncInfo("Steam Sync: Inventar ist leer.");
      }
      finishStep(steps[3]);
    }

    const dashboardStep = hasSteamId ? steps[3] : steps[1];
    startStep(dashboardStep);
    await fetchPortfolioData({ scope: "investments", rowScope: "investments" });
    finishStep("");

    setSetupProgress({
      total: steps.length,
      completed,
      currentStep: "Bereit",
      inProgress: false,
      done: true,
    });
    setIsDashboardReady(true);
    preparationStateRef.current = {
      key: prepKey,
      running: false,
      finished: true,
    };
  };

  useEffect(() => {
    const checkAuth = async () => {
      const authenticated = await isAuthenticated();
      if (!authenticated) {
        return;
      }
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        return;
      }
      const hydratedUser = await hydrateUserMediaIfNeeded(currentUser);
      setUser(hydratedUser);
      try {
        await runPostLoginPreparation(hydratedUser);
      } catch (err) {
        markPreparationFailed(err);
      }
    };
    void checkAuth();
  }, []);

  const handleSteamLogin = async () => {
    setIsLoading(true);
    setError("");

    try {
      const isWeb = typeof window !== "undefined" && window.electronAPI === undefined;
      const result = await initiateSteamLogin();

      if (isWeb && !result) {
        return;
      }

      if (result?.success) {
        const hydratedUser = await hydrateUserMediaIfNeeded(result.user);
        setUser(hydratedUser);
        try {
          await runPostLoginPreparation(hydratedUser);
        } catch (prepError) {
          markPreparationFailed(prepError);
        }
      } else {
        setError(result?.error || "Login failed");
      }
    } catch (err) {
      setError(err.message || "Failed to initiate Steam login");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevModeLogin = async () => {
    setIsLoading(true);
    setError("");

    try {
      const result = await devModeLogin();

      if (result.success) {
        const hydratedUser = await hydrateUserMediaIfNeeded(result.user);
        setUser(hydratedUser);
        try {
          await runPostLoginPreparation(hydratedUser);
        } catch (prepError) {
          markPreparationFailed(prepError);
        }
      } else {
        setError("Dev mode login failed");
      }
    } catch (err) {
      setError(err.message || "Failed to start dev mode");
    } finally {
      setIsLoading(false);
    }
  };

  if (user) {
    const progressPercent =
      setupProgress.total > 0
        ? Math.max(0, Math.min(100, Math.round((setupProgress.completed / setupProgress.total) * 100)))
        : 0;
    const { preferredAvatarUrl, staticAvatarUrl } = resolveAvatarUrls(user);
    const avatarIsVideo = isVideoAvatarUrl(preferredAvatarUrl);

    return (
      <Card className="relative mx-auto w-full max-w-lg overflow-hidden border-white/15 bg-slate-950/58 text-slate-100 shadow-2xl backdrop-blur-xl">
        <CardHeader className="relative z-10 pb-3">
          <CardTitle className="text-2xl tracking-tight text-slate-50">Willkommen, {user.name}!</CardTitle>
          <CardDescription className="text-sm leading-relaxed text-slate-300">
            {user.isDevMode
              ? "Dev Mode ist aktiv. Deine lokalen Daten werden jetzt vorbereitet."
              : "Dein Steam-Account ist verbunden. Wir bereiten jetzt deine Daten fuer das Dashboard vor."}
          </CardDescription>
        </CardHeader>
        <CardContent className="relative z-10 space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-white/15 bg-white/5 p-3">
            {preferredAvatarUrl ? (
              avatarIsVideo ? (
                <video
                  src={preferredAvatarUrl}
                  poster={staticAvatarUrl || undefined}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="h-14 w-14 rounded-full object-cover ring-2 ring-primary/30"
                  aria-label={`${user.name} Steam Avatar`}
                />
              ) : (
                <img
                  src={preferredAvatarUrl}
                  alt={user.name}
                  className="h-14 w-14 rounded-full object-cover ring-2 ring-primary/30"
                />
              )
            ) : null}
            <div>
              <p className="text-lg font-semibold text-slate-100">{user.name}</p>
              <p className="text-sm text-slate-300">{user.isDevMode ? "Dev Mode" : "Steam verbunden"}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>{setupProgress.currentStep || "Vorbereitung"}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className={`h-full rounded-full bg-cyan-300 transition-[width] duration-500 ${
                  setupProgress.inProgress ? "steam-progress-pulse" : ""
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-300">
              Schritt {Math.min(setupProgress.completed, setupProgress.total)} von {setupProgress.total}
            </p>
          </div>

          {syncInfo ? (
            <div className="rounded-md border border-emerald-300/35 bg-emerald-500/15 p-2 text-xs text-emerald-200">
              {syncInfo}
            </div>
          ) : null}

          <Button
            type="button"
            className="w-full bg-white/95 text-slate-950 hover:bg-white"
            disabled={!isDashboardReady}
            onClick={() => onLoginSuccessRef.current?.(user)}
          >
            {isDashboardReady ? "Zum Dashboard" : "Daten werden geladen..."}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Welcome to CS Investor Hub</CardTitle>
        <CardDescription>
          Connect your Steam account to track your CS2 portfolio and investments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Secure Steam OpenID authentication</p>
          <p>Import your CS2 inventory automatically</p>
          <p>Track prices and portfolio value</p>
          <p>Local-first: Your data stays on your device</p>
        </div>

        <Button
          onClick={handleSteamLogin}
          disabled={isLoading}
          className="w-full bg-[#1b2838] text-white hover:bg-[#2a475e]"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Connecting to Steam...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.72 1.97 4.52 5.15 4.52 8.66 0 2.36-.76 4.54-2.07 6.33l-1.55-1.04z" />
              </svg>
              Sign in with Steam
            </span>
          )}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or</span>
          </div>
        </div>

        <Button onClick={handleDevModeLogin} disabled={isLoading} variant="outline" className="w-full">
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            Continue in Dev Mode (no server)
          </span>
        </Button>
      </CardContent>
    </Card>
  );
}
