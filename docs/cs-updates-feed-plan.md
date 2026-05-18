# CS Updates Feed Plan (WebSocket + Steam News API)

Status: IN PROGRESS  
Updated: 2026-05-14  
Owner: backend + shared frontend

## 0. Warum der alte Plan schwach war

Die bisherige Version war als Produkt-Idee gut, aber als Umsetzungsplan zu ungenau.

Hauptprobleme:
- Pfade waren teilweise veraltet (`src/...` statt Monorepo-Pfade wie `packages/shared/...`).
- Es fehlte ein fester Dedupe-Key fuer Feed-Eintraege.
- "WebSocket" war genannt, aber ohne Betriebskonzept (PHP Frontcontroller ist kein dauerhafter WS-Server).
- Keine klaren Reconnect/Fallback-Regeln fuer Clients.
- Keine harten Akzeptanzkriterien pro Schritt.

Dieses Dokument ersetzt den alten Plan durch eine Schritt-fuer-Schritt-Checkliste, die auch von einem einfachen Coding-Agent sauber abgearbeitet werden kann.

---

## 1. Ziel (klar und testbar)

Wir wollen CS2-Update-Events aus der Steam News API automatisch einspeisen und an Web/Electron nahezu live ausliefern.

Muss am Ende gelten:
1. Server speichert neue News-Eintraege dedupliziert in DB.
2. Feed ist per REST abrufbar.
3. Neue Eintraege werden per WebSocket an aktive Clients gepusht.
4. Wenn WebSocket ausfaellt, funktioniert Polling-Fallback.

---

## 2. Architektur-Entscheidung

### 2.1 Datenquelle
- Primaer: Valve `ISteamNews/GetNewsForApp` (`appid=730`, `steam_community_announcements`).
- SteamDB RSS kann spaeter optional als Zusatzquelle dienen, ist aber in manchen Container-Laufzeiten per `HTTP 403` blockiert.
- Kein Discord-Scraping.

### 2.2 Transport zu Clients
- REST fuer Initial-Laden + Nachladen.
- WebSocket fuer Live-Push.

### 2.3 Wichtiger Betriebs-Punkt
- Der bestehende `backend/public/index.php` ist request-basiert und kein dauerhafter WS-Loop.
- Deshalb: **separater WebSocket-Gateway-Prozess** als eigener Worker.
- Dieser Gateway darf in Node.js laufen (einfacher Betrieb), waehrend Business-Logik/DB in PHP bleibt.

---

## 3. Datenmodell (MVP)

Neue Tabelle: `cs_updates_feed`

Pflichtspalten:
- `id` BIGINT PK AUTO_INCREMENT
- `source` VARCHAR(32) NOT NULL (`steam_news_api`)
- `external_id` VARCHAR(191) NOT NULL
- `title` VARCHAR(512) NOT NULL
- `url` VARCHAR(1024) NOT NULL
- `summary_raw` TEXT NULL
- `published_at` DATETIME NOT NULL
- `changelist_id` BIGINT NULL
- `build_id` BIGINT NULL
- `branch` VARCHAR(64) NULL
- `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

Indizes:
- UNIQUE `ux_cs_updates_external_id` (`external_id`)
- INDEX `ix_cs_updates_published_at` (`published_at`)
- INDEX `ix_cs_updates_changelist_id` (`changelist_id`)

`external_id` Regel:
- Wenn `gid` vorhanden: nutze `gid`.
- Sonst: `sha1(url + "|" + published_at_iso + "|" + title)`.

---

## 4. API/WS Vertrag

## 4.1 REST
`GET /api/v1/cs-updates?limit=50&before=<iso8601_optional>`

Antwort:
- `items[]` (absteigend nach `publishedAt`)
- `meta.fetchedAt`
- `meta.nextBefore` (fuer Pagination)

Item-Shape:
- `id`
- `source`
- `title`
- `summary`
- `url`
- `publishedAt`
- `changelistId`
- `buildId`
- `branch`

## 4.2 WebSocket Events

WS URL (Beispiel):
- `wss://<host>/ws/updates`

Events:
1. Server -> Client `hello`
2. Client -> Server `subscribe` mit `{ "topic": "cs_updates" }`
3. Server -> Client `cs_update.created` mit einem Feed-Item
4. Ping/Pong alle 25s

---

## 5. Polling- und Realtime-Raten

- News Ingest Worker: alle **60 Sekunden**
- WebSocket Push: sofort nach Insert
- Client Polling-Fallback:
  - wenn WS disconnected: alle **60 Sekunden**
  - wenn WS connected: kein permanentes Polling, nur Initial Load + Reconnect-Sync

---

## 6. Implementierungsplan (Abarbeitbar fuer einfache KI)

Wichtig: Jeder Schritt hat "Done-Check". Nicht zum naechsten Schritt springen, bevor Done-Check gruen ist.

### Schritt 1 - DB Migration

Datei:
- `backend/sql/migrations/2026_05_14_001_cs_updates_feed.sql`

Aufgaben:
1. Tabelle `cs_updates_feed` erstellen.
2. Indizes/Unique Key erstellen.

Done-Check:
- Migration laeuft lokal ohne SQL-Fehler.
- `DESCRIBE cs_updates_feed` zeigt alle Pflichtspalten.

---

### Schritt 2 - Repository

Neue Datei:
- `backend/src/Infrastructure/Persistence/Repository/CsUpdatesFeedRepository.php`

Methoden:
1. `upsert(array $row): bool` (idempotent per `external_id`)
2. `listLatest(int $limit, ?string $beforeIso): array`
3. `findByExternalId(string $externalId): ?array`

Done-Check:
- Upsert erzeugt keine Duplikate bei 2x gleichem Entry.
- List liefert `published_at DESC`.

---

### Schritt 3 - News Client + Parser Service

Neue Dateien:
- `backend/src/Infrastructure/External/SteamNewsClient.php`
- `backend/src/Application/Service/CsUpdatesIngestService.php`

Regeln:
1. Endpoint aus ENV `CS_UPDATES_STEAM_NEWS_URL` (oder Default auf Steam API Endpoint).
2. HTTP Timeout max 10s.
3. Parser extrahiert aus `newsitems`: `title`, `url`, `published_at`, `summary_raw`.
4. Regex versucht `changelist/build/branch` zu erkennen.
5. `external_id` wie in Abschnitt 3.

Done-Check:
- Service kann mind. 1 echten News Entry in normiertes Array mappen.
- Bei Netzwerkfehler: sauberer Fehlerlog, kein Crash.

---

### Schritt 4 - Ingest Worker Script

Neue Datei:
- `backend/sync-cs-updates-rss.php`

Aufgaben:
1. Bootstrap laden.
2. Steam News holen.
3. Alle Entries upserten.
4. Ausgabe-Log:
   - total_entries
   - inserted_count
   - updated_count
   - skipped_count

Done-Check:
- Script lokal manuell ausfuehrbar.
- Zweiter Lauf direkt danach erzeugt `inserted_count = 0` (idempotent).

---

### Schritt 5 - REST Controller + Route

Neue Datei:
- `backend/src/Http/Controller/CsUpdatesController.php`

Aenderung:
- `backend/public/index.php` Route registrieren:
  - `GET /api/v1/cs-updates`

Done-Check:
- Endpoint liefert JSON mit `items` + `meta`.
- `limit` funktioniert.

---

### Schritt 6 - WebSocket Gateway (separater Prozess)

Neue Dateien (Node Worker im Repo):
- `apps/desktop/src/localStore/` **nicht** verwenden.
- Neuer Ordner:
  - `backend/ws-gateway/server.mjs`
  - `backend/ws-gateway/package.json`

Gateway-Aufgaben:
1. WS Server auf Port aus ENV `CS_UPDATES_WS_PORT`.
2. Accept `subscribe` fuer `cs_updates`.
3. Bekommt neue Items ueber leichtes internes Signal:
   - Variante A (MVP): Poll jede 5s auf `MAX(id)` in DB und broadcast neue Rows.
   - Variante B (spaeter): Queue/Redis PubSub.
4. Sendet `cs_update.created` Event.

Done-Check:
- Mit 2 Clients verbunden: beide erhalten neues Event.
- Reconnect funktioniert nach Gateway-Restart.

Hinweis:
- Variante A ist absichtlich simpel und robust fuer MVP.

---

### Schritt 7 - Frontend Hook + Komponenten

Bestehende Dateien nutzen/anpassen:
- `packages/shared/src/lib/apiClient.js`
- `packages/shared/src/hooks/useCsUpdatesFeed.js`
- `packages/shared/src/components/CsUpdatesFeed.jsx`
- `packages/shared/src/pages/CsUpdatesPage.jsx`

Aufgaben:
1. Initial Feed per REST laden.
2. WS verbinden und `subscribe` senden.
3. Bei `cs_update.created` Item vorne einfuegen (dedupe by `id`).
4. WS reconnect mit Backoff (1s, 2s, 5s, 10s, max 30s).
5. Fallback Polling nur wenn WS disconnected.

Done-Check:
- Neues Update erscheint ohne Page Reload.
- Bei WS-Ausfall aktualisiert sich Feed trotzdem spaetestens nach 60s.

---

### Schritt 8 - Betrieb/Scheduler

Aendern:
- bestehende Cron/Supervisor config (analog zu anderen Workern)

Aufgaben:
1. `sync-cs-updates-rss.php` jede Minute starten.
2. WS Gateway als dauerhaften Prozess starten.

Done-Check:
- Nach Deploy laufen beide Prozesse stabil >24h.
- Keine Prozess-Neustart-Schleifen.

---

## 7. Konkrete Schwachstellen + Gegenmassnahmen

1. Schwachstelle: RSS Format aendert sich.  
Gegenmassnahme: Parser defensiv, fehlende Felder erlauben, Fehler loggen.

2. Schwachstelle: Duplikate.  
Gegenmassnahme: harter UNIQUE Key auf `external_id`.

3. Schwachstelle: WS Instabilitaet.  
Gegenmassnahme: Reconnect + Polling-Fallback.

4. Schwachstelle: Clock/Timezone Fehler.  
Gegenmassnahme: alles in UTC speichern und API nur ISO UTC liefern.

5. Schwachstelle: Lastspitzen bei vielen Clients.  
Gegenmassnahme: leichte Event-Payload, initiale Pagination, spaeter ggf. Redis.

---

## 8. Akzeptanzkriterien (Final)

Feature gilt als "fertig", wenn:
1. Neue CS2 News Entries erscheinen in DB innerhalb 60-120s.
2. REST liefert die letzten 50 Updates sortiert.
3. Offene Clients erhalten neue Updates per WS Push.
4. Bei WS-Down zeigt UI weiter Updates ueber Fallback-Polling.
5. Keine doppelten Feed-Eintraege nach wiederholtem Ingest.

---

## 9. Phase 2 (nicht MVP)

1. Optionales SteamDB-Patchnotes-Enrichment als zweite Quelle.
2. Besserer WS Broadcast ueber Redis PubSub statt DB-Minipolling.
3. Feature-Flag fuer Feed/Realtime separat.
