// Shared click behaviour for app-update notifications.
//
// Update availability is surfaced in three places (sidebar rail bell, CS
// updates page, portfolio dropdown) which previously each carried their own
// copy of this logic. They must stay identical, above all in the fallback:
// whenever an in-place update is impossible — unsupported install, failed
// download, updater error — the user has to end up on the GitHub releases
// page instead of in a dead end.

export const FALLBACK_RELEASES_URL =
  "https://github.com/Control-ger/CsPortfolioTracking/releases/latest";

export function formatUpdateVersionLabel(version) {
  const normalized = String(version || "").trim();
  return normalized ? `v${normalized}` : "Das Update";
}

export async function openAppReleasesPage(url = "") {
  const target = String(url || "").trim() || FALLBACK_RELEASES_URL;
  if (window.electronAPI?.updater?.openReleasesPage) {
    await window.electronAPI.updater.openReleasesPage();
    return true;
  }
  if (window.electronAPI?.openExternal) {
    await window.electronAPI.openExternal(target);
    return true;
  }
  window.open(target, "_blank", "noopener");
  return true;
}

async function offerManualDownload(message, url) {
  const shouldOpen = window.confirm(
    `${message}\n\nMoechtest du die GitHub-Releases-Seite oeffnen und die neue Version manuell herunterladen?`,
  );
  if (shouldOpen) {
    await openAppReleasesPage(url);
  }
}

// Starts the in-place download, but degrades to the manual path whenever the
// main process reports that it cannot (or could not) do it itself.
export async function runAppUpdateDownload({ version = "", url = "" } = {}) {
  const versionLabel = formatUpdateVersionLabel(version);

  if (!window.electronAPI?.updater?.download) {
    await offerManualDownload(`${versionLabel} ist verfuegbar.`, url);
    return;
  }

  const result = await window.electronAPI.updater.download();
  if (!result) {
    await offerManualDownload(
      `${versionLabel}: Der Update-Download hat nicht geantwortet.`,
      url,
    );
    return;
  }
  // Manual mode already opened the releases page in the main process.
  if (result.manual) {
    return;
  }
  if (result.ok !== false) {
    return;
  }

  const resultUrl = result.url || url;
  if (result.reason === "no-update-info") {
    await offerManualDownload(
      `${versionLabel}: Updater-Metadaten sind noch nicht bereit.`,
      resultUrl,
    );
    return;
  }
  if (result.reason === "not-packaged") {
    window.alert("Updates sind nur in der installierten Desktop-App verfuegbar.");
    return;
  }
  await offerManualDownload(
    String(result.error || "Update-Download konnte nicht gestartet werden."),
    resultUrl,
  );
}

// `payload` is the persisted notification payload (or the live updater status).
export async function runAppUpdateAction(payload = {}) {
  const state = String(payload?.state || "").trim().toLowerCase();
  const version = String(payload?.version || "").trim();
  const url = String(payload?.url || "").trim();
  const versionLabel = formatUpdateVersionLabel(version);

  if (state === "downloaded") {
    const shouldInstallNow = window.confirm(
      `${versionLabel} wurde heruntergeladen. Jetzt neu starten und installieren?`,
    );
    if (shouldInstallNow && window.electronAPI?.updater?.install) {
      await window.electronAPI.updater.install();
    }
    return;
  }

  // This install cannot replace itself (AppImage without APPIMAGE, Snap,
  // unpacked build) — GitHub is the only route.
  if (state === "manual") {
    await offerManualDownload(
      `${versionLabel} ist verfuegbar, aber diese Installation kann sich nicht selbst aktualisieren.`,
      url,
    );
    return;
  }

  if (state === "available" || state === "downloading") {
    await runAppUpdateDownload({ version, url });
    return;
  }

  if (state === "error") {
    await offerManualDownload(
      String(payload?.error || payload?.message || "Beim Update ist ein Fehler aufgetreten."),
      url,
    );
  }
}
