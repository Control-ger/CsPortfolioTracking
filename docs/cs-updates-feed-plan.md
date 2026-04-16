# CS Updates Feed Plan (Mini-PRD fuer Coding-Agent)

## 1. Zielbild
Wir fuehren einen sichtbaren CS-Updates-Feed in der Portfolio-UI ein, damit Nutzer aktuelle Counter-Strike-News direkt in der App sehen koennen, ohne externe Quellen separat zu oeffnen.

**Produktziel:**
- Neueste CS-Updates schnell erfassbar anzeigen.
- Mehr Informationen pro Update per Aufklappen bereitstellen.
- Das neueste Update optisch hervorheben, wenn es nicht aelter als 24 Stunden ist.
- Die UI soll auch auf Mobile gut funktionieren.

**Verbindliche UI-Regel:**
- Die neue UI wird ausschliesslich mit `shadcn/ui` aus `src/components/ui/*` gebaut.
- Keine zusaetzliche UI-Library fuer dieses Feature.

## 2. Scope

### MVP
- Feed-Bereich im Portfolio sichtbar machen.
- Mehrere CS-Updates als Liste oder Cards anzeigen.
- Pro Update eine aufklappbare Detailansicht anbieten.
- Das neueste Update unter 24h visuell hervorheben.
- Lade-, Fehler-, Leer- und Aktualisierungszustand abbilden.
- Datenquelle so kapseln, dass spaeter Mock-Daten, Backend-Endpoint oder externe Aggregation austauschbar sind.

### Nicht-Ziele im MVP
- Kein komplettes News-CMS.
- Kein Login- oder Personalization-Refactor.
- Keine Pflicht fuer automatische externe Quellen.
- Kein komplexes Editorial-Tool.

### Perspektivisch
- SteamDB-Feeds integrieren.
- Discord-/Webhook-Aggregation integrieren.
- Backend-Aggregation mehrerer Quellen.
- Quellenbadges, Filter und Priorisierung nach Relevanz.
- Optionales Feature-Flag fuer kontrollierten Rollout, z. B. `FEATURE_CS_UPDATES_FEED`.

## 3. Datenmodell

### 3.1 Feed-Item
Ein Feed-Eintrag soll mindestens folgende Felder besitzen:

- `id`: eindeutige ID
- `title`: kurzer Titel
- `summary`: kompakte Einleitung fuer die Kartenansicht
- `details`: laengerer Text oder strukturierte Detailpunkte
- `publishedAt`: Zeitpunkt der Erstveroefentlichung
- `updatedAt`: optionaler letzter Aenderungszeitpunkt
- `source`: Herkunft, z. B. `mock`, `steam***REMOVED***`, `discord`, `backend_aggregated`
- `sourceLabel`: lesbarer Anzeigename
- `url`: optionaler Link zur Quelle
- `tags`: optionale Schlagworte
- `severity`: optionale Prioritaet, z. B. `info`, `notice`, `warning`, `critical`
- `pinned`: optional fuer wichtige Eintraege
- `isBreaking`: optional fuer besonders auffaellige Meldungen

### 3.2 Meta-Daten
Die Antwort sollte zusaetzlich Metadaten enthalten:

- `fetchedAt`: Zeitpunkt des letzten erfolgreichen Abrufs
- `isStale`: ob die Daten veraltet wirken
- `staleAfterSeconds`: optionaler Richtwert fuer Veraltung
- `sourceMode`: z. B. `mock` oder `backend`
- `lastRefreshAt`: optional fuer UI-Anzeige

### 3.3 Datenquelle-neutraler Vertrag
Die Implementierung soll die UI gegen einen stabilen Feed-Vertrag bauen, damit die Quelle spaeter austauschbar bleibt.

Empfohlene Reihenfolge:
1. Mock-Daten mit realistischem Shape.
2. Optionale Anbindung an einen Frontend-Adapter.
3. Spaeter Austausch gegen Backend-Endpoint ohne UI-Refactor.

## 4. UI/UX-Regeln

### 4.1 Einbauort
Primaer in:
- `src/pages/PortfolioPage.jsx`

Empfohlene Position im Layout:
- im `overview`-Tab, direkt unter den Kennzahlen oder zwischen Kennzahlen und Charts.

### 4.2 Eigene Komponente
Wenn der Bereich groesser wird, in eine eigene Komponente auslagern:
- `src/components/CsUpdatesFeed.jsx`

### 4.3 Empfohlene shadcn/ui-Bausteine
Nur Komponenten aus `src/components/ui/*`, insbesondere:
- `Card`
- `Badge`
- `Button`
- `ScrollArea`
- optional `Tabs`
- optional `Accordion` oder `Collapsible`, falls das projektseitig als shadcn/ui-Baustein vorhanden oder ergaenzt wird

### 4.4 Darstellungsvarianten
Der Coding-Agent darf die visuell passendste Variante waehlen, aber das MVP sollte einfach, klar und responsiv bleiben.

**Variante A – Card-Feed (Empfehlung)**
- Jede Meldung als eigene Card.
- Kurzansicht plus aufklappbare Details.
- Gute Lesbarkeit auf Desktop und Mobile.

**Variante B – Live-Header/Ticker**
- Schmaler Header mit Live-Gefuehl.
- Danach kompakte Feed-Liste.
- Sinnvoll, wenn die Oberfläche sehr platzsparend sein soll.

**Variante C – Accordion-/Collapsible-Liste**
- Mehr Dichte bei mehreren Eintraegen.
- Gut, wenn die Detailtexte laenger werden.
- Nur umsetzen, wenn die Komponente sauber mit shadcn/ui realisierbar ist.

**Empfehlung fuer MVP:** Variante A, weil sie am besten zur bestehenden Portfolio-Optik passt.

### 4.5 Hervorhebung frischer Updates
- Das neueste Update wird anhand von `publishedAt` bestimmt.
- Ist das Update juenger als 24 Stunden, wird es hervorgehoben:
  - Badge wie `Neu` oder `Live`
  - auffaelligere Border oder Hintergrund
  - optional standardmaessig aufgeklappt
- Falls mehrere Updates innerhalb von 24 Stunden vorhanden sind, bleibt nur das neueste besonders markiert; weitere koennen neutral oder schwach markiert sein.

## 5. Zustände und Verhalten

### 5.1 Loading
- Beim Laden wird ein klarer Ladezustand angezeigt.
- Optional Skeleton oder neutrale Card mit kurzem Hinweis.
- Der Bereich sollte im Layout stabil bleiben.

### 5.2 Empty
- Wenn keine Updates vorhanden sind, wird ein freundlicher Empty State angezeigt.
- Der Empty State muss sich klar vom Error-State unterscheiden.

### 5.3 Error
- Bei Netzwerk- oder API-Fehlern wird ein eindeutiger Fehlerzustand angezeigt.
- Wenn bereits Daten vorhanden sind, sollen diese moeglichst sichtbar bleiben und der Fehler nur als Hinweis erscheinen.
- Ein Retry-Button ist vorgesehen.

### 5.4 Refresh / Stale Handling
- Der Feed soll einen manuellen Refresh unterstuetzen.
- Stale-Status soll sichtbar sein, wenn die letzte Aktualisierung aelter ist als gewuenscht.
- Stale darf den Inhalt nicht verstecken.
- Die UI soll zeigen:
  - wann zuletzt erfolgreich geladen wurde,
  - ob ein Refresh laeuft,
  - ob Daten veraltet sind.
- Empfehlenswert ist ein eigener `refreshing`-Zustand zusaetzlich zu `loading`.

## 6. Implementierungsplan mit Dateipfaden

### 6.1 Frontend-Architektur
1. Feed-Daten ueber einen klaren Adapter laden.
2. UI und Datenquelle strikt trennen.
3. Portfolio-Seite als primaren Einbauort waehlen.
4. Bei Bedarf Feed in eigene Komponente auslagern.

### 6.2 Konkrete Dateien

- `src/pages/PortfolioPage.jsx`
  - Feed im `overview`-Bereich integrieren.
  - Optional nur als Container fuer die Komponente nutzen.

- `src/components/CsUpdatesFeed.jsx`
  - Eigenstaendige Feed-UI.
  - Cards/Liste, Expand-Details, Highlight-Logik, Empty/Error/Loading/Refresh.

- `src/hooks/useCsUpdatesFeed.js`
  - Optionaler Hook fuer Laden, Refresh, Stale-Logik und Fehlerbehandlung.
  - Sinnvoll, wenn die Logik aus der UI herausgezogen werden soll.

- `src/lib/csUpdatesFeed.mock.js`
  - Mock-Daten mit realistischem Shape.
  - Dient als Startpunkt fuer die erste UI-Implementierung.

- `src/lib/apiClient.js`
  - Spaeter um `fetchCsUpdatesFeed()` ergaenzen, wenn ein Backend-Endpoint existiert.

### 6.3 Spaetere Backend-Option
Wenn der Feed nicht nur als Mock laufen soll, kann spaeter ein Backend-Endpoint ergaenzt werden, z. B.:

- `backend/src/Http/Controller/CsUpdatesController.php`
- `backend/src/Application/Service/CsUpdatesService.php`
- `backend/src/Infrastructure/Persistence/Repository/CsUpdatesRepository.php`

Fuehrende externe Quellen oder Aggregation perspektivisch:
- `backend/src/Infrastructure/External/SteamDbClient.php`
- `backend/src/Infrastructure/External/DiscordFeedClient.php`

## 7. Akzeptanzkriterien
- Der CS-Updates-Feed ist im Portfolio-UI sichtbar.
- Es werden mehrere Updates als Cards oder Liste dargestellt.
- Das neueste Update unter 24h ist visuell hervorgehoben.
- Details pro Update sind aufklappbar oder ausklappbar.
- `loading`, `empty`, `error` und `stale/refresh` sind klar erkennbar.
- Die Datenquelle ist austauschbar zwischen Mock und spaeterem Backend.
- Die UI verwendet ausschliesslich Komponenten aus `src/components/ui/*`.
- Die Darstellung ist auf Desktop und Mobile brauchbar.
- Kein harter Backend-Zwang im MVP.

## 8. Testplan

### 8.1 Datenlogik
- Sortierung nach `publishedAt` absteigend.
- Erkennung des neuesten Eintrags.
- Erkennung von Updates juenger als 24 Stunden.
- Stale-Berechnung ueber Meta-Daten oder Fallback-Zeitpunkt.
- Fehlerbehandlung bei leerer oder ungueltiger Datenquelle.

### 8.2 UI-Verhalten
- Loading-State wird korrekt angezeigt.
- Empty-State wird korrekt angezeigt.
- Error-State wird korrekt angezeigt.
- Expand/Collapse funktioniert pro Eintrag.
- Refresh zeigt einen eigenen Status.
- Hervorhebung des frischen Updates ist sichtbar, aber nicht uebertrieben.

### 8.3 Integrationscheck
- Feed laesst sich ohne grossen Umbau in `PortfolioPage.jsx` einhaengen.
- Feed bleibt mit spaeterem Backend-Contract kompatibel.
- Keine zusaetzliche UI-Library wird eingefuehrt.

## 9. Rollout
1. Erst Mock-Daten und UI im Frontend aufbauen.
2. Feed in `PortfolioPage.jsx` integrieren.
3. Refresh- und Stale-Logik stabilisieren.
4. Danach optionalen Backend-Endpoint anbinden.
5. Danach externe Quellen wie SteamDB oder Discord ergaenzen.
6. Optional Feature-Flag fuer kontrollierten Rollout verwenden.

## 10. Risiken
- Unklare oder wechselnde Datenformate zwischen Mock und Backend.
- Timestamp- oder Timezone-Probleme bei der 24h-Hervorhebung.
- Zu viel Information auf kleinen Bildschirmen.
- Doppelte Eintraege bei spaeterer Aggregation mehrerer Quellen.
- Layout-UEberladung, wenn Feed und Portfolio-Kennzahlen visuell konkurrieren.
- Accordion-/Collapsible-Variante kann zusaetzliche shadcn-Komponenten erfordern.

## 11. Perspektive
- SteamDB-Feeds automatisiert einspeisen.
- Discord-/Webhook-Aggregation ergaenzen.
- Backend-Aggregation mit Deduplizierung und Priorisierung.
- Quellenbadges und Filter nach Relevanz oder Kanal.
- Optionales Ranking nach Aktualitaet, Impact oder Vertrauensstufe.
- Spaeter Benachrichtigungen oder Badge-Zaehler fuer neue Updates.

## 12. Geplante Datei-Struktur
Primäre Spezifikationsdatei:
- `docs/cs-updates-feed-plan.md`

Spaetere Implementierung:
- `src/pages/PortfolioPage.jsx`
- `src/components/CsUpdatesFeed.jsx`
- `src/hooks/useCsUpdatesFeed.js`
- `src/lib/csUpdatesFeed.mock.js`
- optional spaeter `src/lib/apiClient.js` fuer den Feed-Endpoint

