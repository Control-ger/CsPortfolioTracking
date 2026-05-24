# CS Updates Feed Plan

Status: IN PROGRESS  
Updated: 2026-05-23  
Owner: backend + shared frontend

## 1. Zielbild

Der CS-Updates-Feed soll:
1. neue CS2-Updates zeitnah ingesten,
2. dedupliziert speichern,
3. in Web/Desktop als "letzte 7 Tage" laden,
4. bei Bedarf aeltere Meldungen per "Load older" nachladen,
5. Realtime-Updates per WS liefern, mit Polling-Fallback.

## 2. Aktueller Implementierungsstand (Ist-Stand)

### 2.1 Ingest-Pipeline

- Worker: `backend/sync-cs-updates-rss.php`
- Service: `backend/src/Application/Service/CsUpdatesIngestService.php`
- Repository: `backend/src/Infrastructure/Persistence/Repository/CsUpdatesFeedRepository.php`

Datenquellen-Reihenfolge:
1. Primaer: SteamDB Patchnotes RSS (`steamdb_rss`)
2. Fallback: Steam News API (`steam_news_api`) falls RSS leer/fehlerhaft

Enrichment:
- Build-/Title-Matching gegen Steam-News-Inhalte
- Optionales Patchnotes-Nachladen via `SteamDbPatchnotesClient`
- Summary-Laenge/Budget ueber ENV steuerbar

### 2.2 Datenmodell

Tabelle: `cs_updates_feed`

Kernspalten:
- `id`
- `source`
- `external_id` (UNIQUE, Dedupe-Key)
- `title`
- `url`
- `summary_raw`
- `published_at`
- `changelist_id`
- `build_id`
- `branch`
- `created_at`
- `updated_at`

AI-Spalten (asynchrones Rating):
- `ai_rating_status` (`pending` | `rated` | `failed`)
- `ai_impact_level`
- `ai_impact_score`
- `ai_urgency`
- `ai_recommended_action`
- `ai_reasoning`
- `ai_confidence`
- `ai_model`
- `ai_rated_at`
- `ai_error`

### 2.3 AI-Rating Worker

- Worker: `backend/sync-cs-updates-ai-rating.php`
- Service: `backend/src/Application/Service/CsUpdatesAiRatingService.php`
- Client: `backend/src/Infrastructure/External/GeminiUpdateRaterClient.php`

Hinweis:
- Worker ist bewusst optional (deaktiviert ohne `CS_UPDATES_AI_ENABLED` + `GEMINI_API_KEY`).

### 2.4 Web Push

- Controller: `backend/src/Http/Controller/WebPushController.php`
- Repository: `backend/src/Infrastructure/Persistence/Repository/WebPushSubscriptionRepository.php`
- Service: `backend/src/Application/Service/WebPushService.php`

Wakeups werden bei neuen Feed-Eintraegen (und bei High-Impact-AI-Rating) an aktive Subscriptions gesendet.

### 2.5 Realtime Gateway

- Prozess: `backend/ws-gateway/server.mjs`
- WS-Path: `/ws/updates`
- Topic: `cs_updates`
- Event: `cs_update.created`

Der Gateway pollt die REST-API periodisch und broadcastet neue Items.

## 3. API-Vertrag (Backend)

### `GET /api/v1/cs-updates`

Query:
- `limit` (default `30`, min `1`, max `100`)
- `before` (optional, cursor fuer aeltere Items)
- `since` (optional, Zeitfensterfilter; UI nutzt standardmaessig 7 Tage)

Desktop-Hinweis:
- Der Desktop-Sidecar-Proxy reicht `limit`, `before` und `since` an den Upstream durch.

Response:
- `data.items[]`
- `meta.fetchedAt`
- `meta.sourceMode`
- `meta.nextBefore`
- `meta.hasMore`
- `meta.defaultWindowDays`
- `meta.staleAfterSeconds`
- `meta.bannerVisibleHours`
- `meta.isStale`

Item-Felder (Auszug):
- `id`, `source`, `sourceLabel`
- `title`, `summary`, `details`
- `url`, `publishedAt`, `updatedAt`
- `changelistId`, `buildId`, `branch`
- `tags[]`, `highlights[]`
- `aiRatingStatus`, `aiImpactLevel`, `aiImpactScore`, `aiUrgency`
- `aiRecommendedAction`, `aiReasoning`, `aiConfidence`, `aiModel`, `aiRatedAt`

## 4. Frontend-Verhalten (Current)

Relevante Dateien:
- `packages/shared/src/hooks/useCsUpdatesFeed.js`
- `packages/shared/src/components/CsUpdatesFeed.jsx`
- `packages/shared/src/pages/CsUpdatesPage.jsx`

Verhalten:
- Initial-Load standardmaessig auf letztes `7`-Tage-Fenster.
- Aeltere Eintraege werden ueber `before`-Cursor nachgeladen (`Load older`).
- Snapshot-Cache fuer Feeddaten mit TTL `120s`.
- Realtime per WS, wenn `VITE_CS_UPDATES_WS_ENABLED` aktiv ist.
- Bei WS-Ausfall: Polling-Fallback alle `15s`.
- WS-Reconnect mit Backoff (`1s`, `2s`, `5s`, `10s`, `30s`) und Cooldown.

## 5. Konfigurationspunkte

Backend:
- `CS_UPDATES_ENRICH_MAX_PER_RUN`
- `CS_UPDATES_SUMMARY_MAX_LENGTH`
- `CS_UPDATES_BANNER_DURATION_HOURS`
- `CS_UPDATES_AI_ENABLED`
- `GEMINI_API_KEY`
- `CS_UPDATES_AI_BATCH_SIZE`
- `CS_UPDATES_AI_MIN_AGE_SECONDS`

WS Gateway:
- `CS_UPDATES_WS_PORT`
- `CS_UPDATES_API_BASE_URL`
- `CS_UPDATES_WS_POLL_MS`
- `CS_UPDATES_WS_HISTORY_LIMIT`

Frontend:
- `VITE_CS_UPDATES_WS_ENABLED`
- `VITE_CS_UPDATES_WS_URL` (optional override)

## 6. Offene Punkte / Next Steps

1. Betriebsdoku fuer Scheduler/Process-Manager (Ingest + AI + WS) repo-nah vereinheitlichen.
2. Einheitliches Monitoring fuer ingest/ai/ws (Lag, Fehlerraten, reconnect-rates) ausbauen.
3. Contract-Tests fuer `/api/v1/cs-updates` (Pagination + since/before-Kombinationen) ergaenzen.
4. Klaren Rollout-Guard fuer WebPush (configured vs. disabled states) im Deployment-Guide verankern.

## 7. Abnahmekriterien

Feature gilt als stabil, wenn:
1. Neue Updates erscheinen dedupliziert in `cs_updates_feed`.
2. UI zeigt standardmaessig nur die letzten 7 Tage.
3. "Load older" laedt aeltere Ergebnisse ohne Voll-Reload nach.
4. Bei WS-Ausfall bleiben Updates ueber Polling sichtbar.
5. AI-Rating wird asynchron nachgezogen, ohne den Erstimport zu blockieren.
