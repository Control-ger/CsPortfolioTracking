# CS Investor Hub

CS Investor Hub ist ein React + PHP Projekt zum Tracking von CS2 Portfolio- und Watchlist-Daten.

## Tech Stack

- Frontend: React (Vite), Tailwind CSS, shadcn/ui, Recharts
- Backend: PHP 8.x (MVC-artige Struktur unter `backend/src`)
- Persistenz: MySQL (PDO)

## Lokaler Start

1. Abhaengigkeiten installieren:
```bash
npm install
```

2. Frontend starten:
```bash
npm run dev
```

3. Production Build:
```bash
npm run build
```

Hinweis: Vite erwartet Node `20.19+` oder `22.12+`.

## Umgebungsvariablen

Dieses Projekt nutzt eine lokale `.env` fuer Backend, Vite-Proxy und `docker-compose.yml`.

1. Vorlage kopieren:
```powershell
Copy-Item .env.example .env
```

2. Werte in `.env` anpassen (mindestens `CSFLOAT_API_KEY`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, Pfade/Ports fuer Docker).

3. Wichtig: `.env` bleibt lokal und wird nicht versioniert. Committe nur `.env.example`.

Pflichtgruppen (je nach Workflow):

- Backend/DB: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `DB_CHARSET`
- Docker/CasaOS: `APP_HOST`, `APP_PORT`, `PMA_PORT`, `PROJECT_ROOT_PATH`, `DIST_PATH`, `BACKEND_PATH`
- API/Debug: `CSFLOAT_API_KEY`, optional `DEBUG` und `OBSERVABILITY_*`

## Backend Einstieg

- Front Controller: `backend/public/index.php`
- Bootstrap: `backend/src/bootstrap.php`
- API-Basis (Frontend): `VITE_API_BASE_URL` oder Standard `${window.location.origin}/api/index.php`

## Observability

Das Projekt verwendet ein strukturiertes Observability-Backend unter `backend/src/Observability`.

### Kernverhalten

- Alle relevanten Backend-Events werden als strukturierte JSON-Events erzeugt.
- Jeder API-Response setzt `X-Request-Id`.
- Bei gesetztem Header `X-Request-Id` wird die ID validiert (Pattern + max. Laenge), sonst neu generiert.
- Bei `OBSERVABILITY_ENABLED=false` ist nur DB-Write aus; File-Logging/Fallback bleibt aktiv.
- `observability_events` wird automatisch angelegt (`JSON` mit automatischem `LONGTEXT`-Fallback).

### Wichtige Env Flags

- `OBSERVABILITY_ENABLED` (default: `true`)
- `OBSERVABILITY_EVENTS_API_ENABLED` (default: `false`)
- `OBSERVABILITY_FRONTEND_TELEMETRY_ENABLED` (default: `false`)
- `OBSERVABILITY_RETENTION_DAYS` (default: `30`)
- `DEBUG` (aktiviert intern zusaetzlich Debug-Endpunkte/Verhalten)

### Startup Events

Beim Prozessstart werden einmalig geschrieben:

- `system.bootstrap.completed`
- `system.config.active`
- `system.db.ready`

### Frontend Telemetry

- Client erfasst:
- `window.error`
- `window.unhandledrejection`
- React Error Boundary
- API Fetch-Fehler

- Ingestion Endpoint:
- `POST /api/v1/observability/frontend-events`

- Schutzmechanismen:
- Clientseitiges Rate-Limit: max. 20 Events/Minute
- Serverseitiges Rate-Limit: max. 20 Events/Minute pro IP
- Payload-Limit: 8KB

### Observability API / Debug

- `GET /api/v1/observability/events`
- Filter: `category`, `level`, `event`, `requestId`, `from`, `to`, `limit`
- Endpoint ist per Env-Guard abgesichert (`DEBUG` oder `OBSERVABILITY_EVENTS_API_ENABLED`)

- `GET /api/v1/debug/logs`
- Liest primaer aus `observability_events`, faellt bei Bedarf auf Legacy-Dateien zurueck

- `GET /api/v1/debug/csfloat`
- Nutzt primaer Events, zeigt Legacy Proxy Logs weiter kompatibel an

Legacy Log-Dateien:

- `/var/www/html/logs/app.log`
- `/var/www/html/logs/csfloat_proxy.log`

## Verifikation

### Frontend

```bash
npx eslint src/lib/frontendTelemetry.js src/components/AppErrorBoundary.jsx src/main.jsx src/lib/apiClient.js
npm run build
```

### PHP Syntax Check (Beispiel Windows PowerShell)

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
php -l backend/public/index.php
```

## Hinweise

- In diesem Repo koennen noch andere, nicht-observability-bezogene Lint-Warnungen existieren.
- Fuer produktive Retention sollte ein periodischer Job fuer `observability_events` eingerichtet werden.
