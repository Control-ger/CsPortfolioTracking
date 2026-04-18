# Observability-Backend: Umsetzungsplan (AI-Ready)

## 1. Ziel
Ein eigenes, erweiterbares Observability-Backend innerhalb des bestehenden `backend` implementieren, das:

- bestehende Logging-Features zentralisiert
- neue Logging-Anforderungen vollständig abdeckt
- strukturierte Events für Debugging, Monitoring und spätere Feature-Erweiterungen bereitstellt

Dieses Dokument ist so geschrieben, dass eine andere KI die Umsetzung direkt anhand der Schritte ausführen kann.

## 2. Scope und Erfolgskriterien

### In Scope
- Backend-Requests: `method`, `route`, `statusCode`, `durationMs`, `requestId`
- Domain-Aktionen: Watchlist create/delete, Daily Value save, Price refresh
- Externe APIs: CSFloat, Steam, Exchange Rate inkl. `httpCode`, Dauer, Fallback, Cache hit/miss
- Fehler: Exceptions, Validierung, 404/409/500, Curl/JSON
- Datenbank: Verbindungsfehler, failed insert/upsert, fehlende Tabellen/Spalten, unerwartet leere Ergebnisse
- Systemstart: `.env` Status, DB erreichbar, aktive Konfiguration
- Frontend-Fehler: Fetch-Fehler, UI-Ausnahmen, unhandled promise rejections

### Out of Scope (für MVP)
- Vollwertiges Dashboard mit Charts
- Externe Log-Pipelines (ELK/Datadog/OpenTelemetry Collector)
- AuthN/AuthZ für interne Debug-Endpunkte (nur vorbereiten, nicht komplett umsetzen)

### Definition of Done (global)
- Alle geforderten Event-Arten werden als strukturierte JSON-Events geschrieben
- Jeder API-Response enthält `X-Request-Id`
- Frontend-Fehler landen im Backend-Observability-Store
- Bestehende Logs bleiben rückwärtskompatibel lesbar (Migration ohne Breaking Change)
- Automatisierte Tests für kritische Pfade vorhanden

## 3. Zielarchitektur

## 3.1 Modulstruktur (neu)
Unter `backend/src/Observability`:

- `Domain/LogEvent.php` (Event-Modell)
- `Domain/LogLevel.php` (`debug|info|warning|error`)
- `Domain/LogCategory.php` (`http|domain|external|error|db|system|frontend`)
- `Context/RequestContext.php` (`requestId`, `method`, `path`, optional `userAgent`, `ip`)
- `Context/RequestContextStore.php` (statischer Request-Kontext pro Request)
- `Sanitization/ContextSanitizer.php` (PII/Secrets entfernen)
- `Infrastructure/Persistence/ObservabilityEventRepository.php` (DB write + query)
- `Infrastructure/Sink/FileSink.php` (optional fallback für Datei-Logs)
- `Application/ObservabilityService.php` (zentrale API fürs Logging)
- `Application/ExternalCallLogger.php` (helper für API Calls)
- `Http/Controller/ObservabilityController.php` (`GET /api/v1/observability/events`)
- `Http/Controller/FrontendTelemetryController.php` (`POST /api/v1/observability/frontend-events`)

## 3.2 Datenfluss
1. Request kommt rein -> `requestId` setzen/übernehmen -> `RequestContextStore::set(...)`.
2. Domain/External/DB/Fehler-Events rufen `ObservabilityService->log(...)` auf.
3. Service sanitizt Kontext und schreibt in DB (`observability_events`) + optional Datei.
4. Debug-Endpunkte lesen primär aus `observability_events`, alte Dateien als Fallback.

## 4. Event-Schema (verbindlich)

Jedes Event muss mindestens folgende Felder haben:

```json
{
  "timestamp": "2026-04-08T21:18:00Z",
  "level": "info",
  "category": "http",
  "event": "http.request.completed",
  "message": "HTTP request completed",
  "requestId": "req_8f2b1e...",
  "method": "GET",
  "route": "/api/v1/watchlist",
  "statusCode": 200,
  "durationMs": 34,
  "context": {
    "query": {"syncLive":"1"},
    "meta": {"apiVersion":"v1"}
  }
}
```

### Regeln
- `event`: punktgetrennt, stabil (`http.request.completed`, `external.csfloat.request`)
- `context`: nur JSON-serialisierbar
- Secrets redakten: `authorization`, `api_key`, `password`, `token`, `cookie`
- Max Event-Größe: 16KB (`context` bei Überschreitung kürzen + Flag `contextTruncated=true`)

## 5. Datenbankmodell

Neue Tabelle `observability_events` (über Repository `ensureTable()` erstellt):

```sql
CREATE TABLE IF NOT EXISTS observability_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    timestamp_utc DATETIME NOT NULL,
    level VARCHAR(16) NOT NULL,
    category VARCHAR(32) NOT NULL,
    event_name VARCHAR(128) NOT NULL,
    message VARCHAR(512) NOT NULL,
    request_id VARCHAR(64) DEFAULT NULL,
    method VARCHAR(16) DEFAULT NULL,
    route VARCHAR(255) DEFAULT NULL,
    status_code INT DEFAULT NULL,
    duration_ms INT DEFAULT NULL,
    context_json JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ts (timestamp_utc),
    INDEX idx_level (level),
    INDEX idx_category (category),
    INDEX idx_event_name (event_name),
    INDEX idx_request_id (request_id),
    INDEX idx_route_status (route, status_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Retention-Task (später cron):
- Default: 30 Tage
- SQL: `DELETE FROM observability_events WHERE timestamp_utc < (UTC_TIMESTAMP() - INTERVAL 30 DAY)`

## 6. Implementierungsphasen (verbindliche Reihenfolge)

## Phase 1: Fundament (Observability-Core)
### Dateien erstellen
- `backend/src/Observability/...` gemäß Modulstruktur

### Dateien ändern
- [backend/src/Shared/Logger.php](C:/development/CsPortfolioTracking/backend/src/Shared/Logger.php):
  - als Adapter behalten
  - intern auf `ObservabilityService` delegieren
  - Dateilogging als Fallback erhalten (Rückwärtskompatibilität)

### Anforderungen
- `ObservabilityService` API:
  - `log(string $level, string $category, string $event, string $message, array $context = []): void`
  - `info|warning|error|debug` convenience Methoden
- Kein Throw aus Logger nach außen (Logging darf Request nicht crashen)

### DoD Phase 1
- Aufruf `Logger::info(...)` erzeugt Event in `observability_events`
- Bei DB-Problemen wird weiterhin in Datei geloggt

## Phase 2: Request Lifecycle Logging
### Dateien ändern
- [backend/src/Shared/Http/Request.php](C:/development/CsPortfolioTracking/backend/src/Shared/Http/Request.php)
  - `headers` hinzufügen
  - `requestId` optional aufnehmen
- [backend/public/index.php](C:/development/CsPortfolioTracking/backend/public/index.php)
  - Request-ID erzeugen oder Header `X-Request-Id` übernehmen
  - `header('X-Request-Id: ...')` setzen
  - Startzeit erfassen und nach Dispatch `http.request.completed` loggen
  - Für unhandled Throwable: `error.unhandled_exception` + 500 JSON response

### Zu loggende Events
- `http.request.started` (optional debug)
- `http.request.completed` (info)
- `http.request.failed` (error)

### DoD Phase 2
- Jeder Response hat `X-Request-Id`
- Für jede API-Anfrage gibt es mindestens ein `http.request.completed` Event

## Phase 3: Domain- und Fehler-Events
### Dateien ändern
- [backend/src/Application/Service/WatchlistService.php](C:/development/CsPortfolioTracking/backend/src/Application/Service/WatchlistService.php)
- [backend/src/Application/Service/PortfolioService.php](C:/development/CsPortfolioTracking/backend/src/Application/Service/PortfolioService.php)
- [backend/src/Http/Controller/WatchlistController.php](C:/development/CsPortfolioTracking/backend/src/Http/Controller/WatchlistController.php)
- [backend/src/Http/Controller/PortfolioController.php](C:/development/CsPortfolioTracking/backend/src/Http/Controller/PortfolioController.php)
- [backend/src/Shared/Http/Router.php](C:/development/CsPortfolioTracking/backend/src/Shared/Http/Router.php)

### Domain-Events (mindestens)
- `domain.watchlist.item_created`
- `domain.watchlist.item_deleted`
- `domain.watchlist.price_refresh_started`
- `domain.watchlist.price_refresh_completed`
- `domain.portfolio.daily_value_saved`

### Fehler-Events
- `error.validation` (400)
- `error.route_not_found` (404)
- `error.conflict` (409)
- `error.http_5xx`
- `error.curl`
- `error.json_decode`

### DoD Phase 3
- Alle genannten Domain-Aktionen erzeugen strukturierte Events
- 404/409/500 sind im Observability-Store nachvollziehbar

## Phase 4: External API Observability (CSFloat/Steam/Exchange)
### Dateien ändern
- [backend/src/Infrastructure/External/CsFloatClient.php](C:/development/CsPortfolioTracking/backend/src/Infrastructure/External/CsFloatClient.php)
- [backend/src/Infrastructure/External/SteamMarketClient.php](C:/development/CsPortfolioTracking/backend/src/Infrastructure/External/SteamMarketClient.php)
- [backend/src/Infrastructure/External/ExchangeRateClient.php](C:/development/CsPortfolioTracking/backend/src/Infrastructure/External/ExchangeRateClient.php)
- [backend/src/Application/Service/PricingService.php](C:/development/CsPortfolioTracking/backend/src/Application/Service/PricingService.php)

### Zu loggende Felder
- `provider`: `csfloat|steam|exchange_rate`
- `httpCode`
- `durationMs`
- `success`
- `cacheHit|cacheMiss`
- `fallbackUsed`
- `errorCode` (bei Fehlern)

### Konkrete Events
- `external.csfloat.request`
- `external.csfloat.response`
- `external.steam.request`
- `external.steam.response`
- `external.exchange_rate.request`
- `external.exchange_rate.response`
- `external.pricing.cache_hit`
- `external.pricing.cache_miss`
- `external.pricing.fallback_to_steam`

### DoD Phase 4
- Für jeden externen Request gibt es Response-Event mit Dauer + Status
- Cache Hit/Miss und Fallback sind im Event-Stream sichtbar

## Phase 5: DB Observability
### Dateien ändern
- [backend/src/Infrastructure/Persistence/DatabaseConnectionFactory.php](C:/development/CsPortfolioTracking/backend/src/Infrastructure/Persistence/DatabaseConnectionFactory.php)
- alle Repository-Dateien unter `backend/src/Infrastructure/Persistence/Repository`

### Events
- `db.connection.success|failed`
- `db.schema.ensure_table`
- `db.schema.migration_column_added`
- `db.query.failed`
- `db.upsert.failed`
- `db.result.empty_unexpected` (nur auf explizit markierten kritischen Pfaden)

### Implementierungsregel
- `try/catch (\Throwable $e)` um `execute()/exec()/query()` mit `throw` nach dem Log
- Nicht jedes `findAll() == []` loggen, nur wo fachlich "unerwartet leer" gilt

### DoD Phase 5
- DB-Verbindungsfehler und Upsert-Fehler erzeugen Events mit SQL-Kontext (sanitized)

## Phase 6: Systemstart-Events
### Dateien ändern
- [backend/src/bootstrap.php](C:/development/CsPortfolioTracking/backend/src/bootstrap.php)
- [backend/public/index.php](C:/development/CsPortfolioTracking/backend/public/index.php)

### Anforderungen
- Bootstrap sammelt Diagnosen in einem strukturierten Array:
  - `envLoaded` (bool)
  - `envPath` (string|null)
  - `autoloadReady` (bool)
- Nach Logger-Initialisierung in `index.php`:
  - `system.bootstrap.completed`
  - `system.config.active`
  - `system.db.ready`

### DoD Phase 6
- Ein Startup-Log pro Prozessstart enthält `.env` und DB-Status

## Phase 7: Frontend Error Ingestion
### Dateien erstellen
- `src/lib/frontendTelemetry.js`
- `src/components/AppErrorBoundary.jsx`

### Dateien ändern
- [src/main.jsx](C:/development/CsPortfolioTracking/src/main.jsx)
- [src/lib/apiClient.js](C:/development/CsPortfolioTracking/src/lib/apiClient.js)
- [backend/public/index.php](C:/development/CsPortfolioTracking/backend/public/index.php) (Route registrieren)
- neuer Controller unter `backend/src/Observability/Http/Controller/FrontendTelemetryController.php`

### Frontend-Instrumentierung
- `window.addEventListener('error', ...)`
- `window.addEventListener('unhandledrejection', ...)`
- React Error Boundary um `<App />`
- In `apiClient` bei Fetch-Fehlern zusätzliches Telemetry-Event senden
- Versand per `navigator.sendBeacon` (fallback `fetch(..., {keepalive:true})`)

### Sicherheitsregeln
- Rate limit clientseitig: max 20 Events pro Minute
- Payload-Maximum: 8KB
- Stacktrace kürzen (z. B. 20 Zeilen)

### DoD Phase 7
- Frontend-Fehler erscheinen in `observability_events` mit `category = frontend`

## Phase 8: Migration bestehender Logs + Debug API
### Dateien ändern
- [backend/src/Http/Controller/DebugController.php](C:/development/CsPortfolioTracking/backend/src/Http/Controller/DebugController.php)
- [backend/csfloat_proxy.php](C:/development/CsPortfolioTracking/backend/csfloat_proxy.php)

### Anforderungen
- DebugController liest primär `observability_events` (Filter: Kategorie, Level, Zeitraum, Request-ID)
- Alte Datei-Logs (`app.log`, `csfloat_proxy.log`) nur Fallback/Legacy
- Bestehende Debug-Route kompatibel halten (`/api/v1/debug/logs`, `/api/v1/debug/csfloat`)

### DoD Phase 8
- Altes und neues Logging über einen zentralen Debug-Endpunkt auswertbar

## 7. API-Spezifikation (neu)

## `POST /api/v1/observability/frontend-events`
Request:
```json
{
  "level": "error",
  "event": "frontend.unhandled_rejection",
  "message": "Promise rejection in WatchlistOverview",
  "context": {
    "url": "https://.../watchlist",
    "userAgent": "...",
    "stack": "..."
  }
}
```

Response:
```json
{
  "data": {"accepted": true},
  "meta": {}
}
```

## `GET /api/v1/observability/events`
Query-Parameter:
- `category`
- `level`
- `event`
- `requestId`
- `from` (ISO)
- `to` (ISO)
- `limit` (default 100, max 1000)

## 8. Testplan (MVP)

## Backend Integration Tests
1. Request an `/api/v1/watchlist` erzeugt `http.request.completed` mit Request-ID.
2. `DELETE` unbekannte ID erzeugt 404 + `error.route_not_found` oder `domain.watchlist.item_deleted` mit `deleted=false`.
3. CSFloat Fehler (simuliert) erzeugt `external.csfloat.response` mit `success=false` und `fallback_to_steam`.
4. DB-Verbindungsfehler beim Boot führt zu `db.connection.failed`.
5. `POST /observability/frontend-events` schreibt Event mit `category=frontend`.

## Frontend Tests
1. Fetch-Fehler in `apiClient` sendet Telemetry-Event.
2. `unhandledrejection` wird gefangen und gesendet.
3. ErrorBoundary sendet Event bei Render-Crash.

## 9. Rollout-Strategie

1. Feature Flag einführen: `OBSERVABILITY_ENABLED=true|false`.
2. Phase 1-4 zunächst mit `enabled=true` nur in Dev/Staging.
3. Phase 5-8 schrittweise aktivieren.
4. Nach Stabilisierung alte Dateilogik schrittweise reduzieren, aber Fallback behalten.

## 10. Implementierungsreihenfolge als Task-Liste (für KI-Agent)

1. Observability-Modul + DB-Tabelle implementieren.
2. `Shared/Logger` auf Observability delegieren, Fallback Datei behalten.
3. Request-ID + Request-Lifecycle-Events in `public/index.php`.
4. Domain/Fehler-Events in Controller/Services ergänzen.
5. External Clients + PricingService instrumentieren (Dauer/Status/Fallback/Cache).
6. DB-Factory + Repositories instrumentieren.
7. Systemstart-Diagnose in `bootstrap.php` + Startup-Event in `index.php`.
8. Frontend Telemetry Endpoint + Frontend Listener/ErrorBoundary.
9. DebugController auf neue Event-Quelle erweitern.
10. Tests + kurze Betriebsdoku (`README` Abschnitt "Observability").

## 11. Mindest-Eventkatalog (muss vorhanden sein)

- `system.bootstrap.completed`
- `system.db.ready`
- `http.request.completed`
- `domain.watchlist.item_created`
- `domain.watchlist.item_deleted`
- `domain.watchlist.price_refresh_started`
- `domain.watchlist.price_refresh_completed`
- `domain.portfolio.daily_value_saved`
- `external.csfloat.response`
- `external.steam.response`
- `external.exchange_rate.response`
- `external.pricing.cache_hit`
- `external.pricing.cache_miss`
- `external.pricing.fallback_to_steam`
- `db.connection.failed`
- `db.query.failed`
- `error.validation`
- `error.http_5xx`
- `frontend.fetch_error`
- `frontend.unhandled_rejection`
- `frontend.ui_exception`

## 12. Hinweise für saubere Umsetzung

- Keine API-Keys oder vollständige Authorization-Header loggen.
- Bei Exceptions immer `class`, `message`, `code`, gekürzten Stack speichern.
- Logging darf nie die Business-Funktion blockieren.
- Eventnamen stabil halten; neue Events ergänzen statt umbenennen.
- Für spätere Features dieselbe Eventstruktur wiederverwenden.
