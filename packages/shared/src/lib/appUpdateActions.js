import { translate } from "./i18n/index.js";

// Shared click behaviour for app-update notifications.
//
// Update availability is surfaced in three places (sidebar rail bell, CS
// updates page, portfolio dropdown) which previously each carried their own
// copy of this logic. They must stay identical, above all in the fallback:
// whenever an in-place update is impossible — unsupported install, failed
// download, updater error — the user has to end up on the GitHub releases
// page instead of in a dead end.

const FALLBACK_RELEASES_URL =
  "https://github.com/Control-ger/CsPortfolioTracking/releases/latest";

function formatUpdateVersionLabel(version) {
  const normalized = String(version || "").trim();
  return normalized ? `v${normalized}` : translate("common:appUpdate.updateGeneric");
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
    translate("common:appUpdate.openReleasesPrompt", { message }),
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
    await offerManualDownload(translate("common:appUpdate.available", { version: versionLabel }), url);
    return;
  }

  const result = await window.electronAPI.updater.download();
  if (!result) {
    await offerManualDownload(
      translate("common:appUpdate.downloadNoAnswer", { version: versionLabel }),
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
      translate("common:appUpdate.metadataNotReady", { version: versionLabel }),
      resultUrl,
    );
    return;
  }
  if (result.reason === "not-packaged") {
    window.alert(translate("common:appUpdate.installedAppOnly"));
    return;
  }
  await offerManualDownload(
    String(result.error || translate("common:appUpdate.downloadStartFailed")),
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
      translate("common:appUpdate.downloadedRestart", { version: versionLabel }),
    );
    if (!shouldInstallNow || !window.electronAPI?.updater?.install) {
      return;
    }
    const result = await window.electronAPI.updater.install();
    // The user dismissed the password prompt — their call, nothing to report.
    if (result?.cancelled) {
      return;
    }
    // Linux deb/rpm cannot install themselves from inside the app (the sandbox
    // blocks the root helper). If elevating out of the sandbox did not work
    // either, the main process opens the package in the system installer and
    // the app keeps running until the user confirms there.
    if (result?.handoff && result?.ok) {
      window.alert(
        translate("common:appUpdate.handoffOpened", { version: versionLabel })
        + translate("common:appUpdate.handoffCloseApp"),
      );
      return;
    }
    if (result && result.ok === false) {
      await offerManualDownload(
        String(result.error || translate("common:appUpdate.installFailed")),
        result.url || url,
      );
    }
    return;
  }

  // This install cannot replace itself (AppImage without APPIMAGE, Snap,
  // unpacked build) — GitHub is the only route.
  if (state === "manual") {
    await offerManualDownload(
      translate("common:appUpdate.cannotSelfUpdate", { version: versionLabel }),
      url,
    );
    return;
  }

  // Both are waiting on something outside the app — a Polkit prompt or the
  // system installer. Re-triggering the install would only stack prompts.
  if (state === "installing") {
    window.alert(translate("common:appUpdate.installing", { version: versionLabel }));
    return;
  }
  if (state === "handoff") {
    window.alert(
      translate("common:appUpdate.handoffOpened", { version: versionLabel })
      + translate("common:appUpdate.handoffCloseApp"),
    );
    return;
  }

  if (state === "available" || state === "downloading") {
    await runAppUpdateDownload({ version, url });
    return;
  }

  if (state === "error") {
    await offerManualDownload(
      String(payload?.error || payload?.message || translate("common:appUpdate.genericError")),
      url,
    );
  }
}
