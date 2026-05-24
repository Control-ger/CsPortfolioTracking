# Observability Backend Plan (Current State + Remaining Work)

Status: IN PROGRESS
Updated: 2026-05-23

## 1. Goal

Keep a single, structured observability path for backend and frontend events, without breaking legacy debugging workflows.

## 2. Verified Current Implementation (cross-checked in repo)

### 2.1 Core observability module exists

Implemented under `backend/src/Observability/`:
- `Domain/LogEvent.php`, `Domain/LogLevel.php`, `Domain/LogCategory.php`
- `Context/RequestContext.php`, `Context/RequestContextStore.php`
- `Sanitization/ContextSanitizer.php`
- `Application/ObservabilityService.php`, `Application/ExternalCallLogger.php`, `Application/ObservabilityServiceRegistry.php`
- `Infrastructure/Persistence/ObservabilityEventRepository.php`
- `Infrastructure/Sink/FileSink.php`
- `Http/Controller/ObservabilityController.php`
- `Http/Controller/FrontendTelemetryController.php`

### 2.2 Request lifecycle instrumentation is active

`backend/public/index.php` currently does all of the following:
- creates/propagates `X-Request-Id`
- writes request context into `RequestContextStore`
- wires `Logger` to `ObservabilityService`
- logs `system.bootstrap.completed`, `http.request.started`, `http.request.completed`
- logs `http.request.failed` and `error.unhandled_exception`
- clears request context at the end of request handling

### 2.3 API routes are registered

In `backend/public/index.php`:
- `GET /api/v1/observability/events`
- `POST /api/v1/observability/frontend-events`

### 2.4 Debug endpoint integration exists

`backend/src/Http/Controller/DebugController.php` reads from `observability_events` first and falls back to legacy log files when needed.

### 2.5 Frontend integration code exists

Monorepo paths (current):
- `packages/shared/src/lib/frontendTelemetry.js`
- `packages/shared/src/components/AppErrorBoundary.jsx`
- `packages/shared/src/lib/apiClient.js`
- `apps/web/src/main.jsx`

## 3. Important Current Behavior

### 3.1 Frontend telemetry is currently hard-disabled in frontend code

`packages/shared/src/lib/frontendTelemetry.js` sets:
- `FRONTEND_TELEMETRY_ENABLED = false`

Impact:
- handlers are imported and installed, but early-return immediately
- no frontend telemetry events are sent in normal runtime

### 3.2 Backend endpoint flags still apply

- `ObservabilityController` requires `DEBUG=true` or `OBSERVABILITY_EVENTS_API_ENABLED=true`
- `FrontendTelemetryController` requires `DEBUG=true` or `OBSERVABILITY_FRONTEND_TELEMETRY_ENABLED=true`

## 4. Remaining Work (short list)

1. Replace frontend hard-disable constant with env-driven switch.
- Example target: `VITE_OBSERVABILITY_FRONTEND_TELEMETRY_ENABLED`
- Keep default `false` in production unless explicitly enabled.

2. Add retention execution path.
- Repository has `pruneOldEvents(...)` but no scheduled execution path is currently wired.

3. Add integration tests for observability endpoints and request-id propagation.
- `GET /api/v1/observability/events`
- `POST /api/v1/observability/frontend-events`
- `X-Request-Id` header presence.

4. Define deployment policy for production access to observability endpoints.
- current state is flag-based; no dedicated auth boundary for these endpoints.

## 5. Definition of Done for this plan

This plan can be marked DONE when:
1. frontend telemetry toggle is env-driven (no hardcoded `false` in runtime path),
2. retention pruning runs automatically (scheduler/worker/cron),
3. endpoint and request-id tests are in CI,
4. production exposure policy for observability endpoints is explicitly documented.
