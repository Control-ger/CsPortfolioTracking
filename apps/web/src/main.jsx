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
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    const message = getChunkLoadErrorMessage(event?.payload);
    if (!isChunkLoadErrorMessage(message)) {
      return;
    }

    const attempted = window.sessionStorage.getItem(CHUNK_RECOVERY_KEY) === "1";
    if (!attempted) {
      event.preventDefault();
      window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, "1");
      window.location.reload();
      return;
    }

    // Nach einem Recovery-Versuch geben wir den Fehler normal durch,
    // damit kein potenzieller Reload-Loop entsteht.
    window.sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
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
