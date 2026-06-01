import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ThemeProvider, ModalProvider } from '@shared/contexts'
import { AppErrorBoundary } from '@shared/components'
import { installFrontendTelemetryHandlers } from '@shared/lib'

installFrontendTelemetryHandlers()

const CHUNK_RECOVERY_KEY = "vite:chunk-recovery:attempted";

function getChunkLoadErrorMessage(errorLike) {
  if (!errorLike) {
    return "";
  }

  if (typeof errorLike === "string") {
    return errorLike;
  }

  if (typeof errorLike.message === "string") {
    return errorLike.message;
  }

  return String(errorLike);
}

function isChunkLoadErrorMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("failed to fetch dynamically imported module")
    || normalized.includes("error loading dynamically imported module")
    || normalized.includes("loading module from")
    || normalized.includes("dynamically imported module")
    || normalized.includes("ns_error_corrupted_content")
    || normalized.includes("mime")
    || normalized.includes("blocked because of a disallowed mime type")
    || (normalized.includes("/assets/") && normalized.includes(".js"))
  );
}

function attemptChunkRecovery(message, preventDefault) {
  if (!isChunkLoadErrorMessage(message)) {
    return false;
  }

  const attempted = window.sessionStorage.getItem(CHUNK_RECOVERY_KEY) === "1";
  if (!attempted) {
    if (typeof preventDefault === "function") {
      preventDefault();
    }
    window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, "1");
    window.location.reload();
    return true;
  }

  // Nach einem Recovery-Versuch geben wir den Fehler normal durch,
  // damit kein potenzieller Reload-Loop entsteht.
  window.sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
  return false;
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    const message = getChunkLoadErrorMessage(event?.payload);
    attemptChunkRecovery(message, () => event.preventDefault());
  });

  window.addEventListener("unhandledrejection", (event) => {
    const message = getChunkLoadErrorMessage(event?.reason);
    attemptChunkRecovery(message, () => event.preventDefault());
  });

  window.addEventListener("error", (event) => {
    const message = getChunkLoadErrorMessage(event?.error || event?.message);
    attemptChunkRecovery(message, () => event.preventDefault());
  });
}

// Only register ServiceWorker for web runtime, never for Electron file://.
if (typeof window !== "undefined" && "serviceWorker" in navigator && window.location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.debug("[SW] Registration failed:", error);
    });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <ThemeProvider>
        <ModalProvider>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </ModalProvider>
      </ThemeProvider>
    </HashRouter>
  </StrictMode>,
)
