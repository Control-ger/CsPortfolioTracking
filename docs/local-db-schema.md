# Desktop Local DB Schema

Ziel: Electron ist local-first. Schreibende Portfolio- und Watchlist-Aktionen landen zuerst in der lokalen SQLite-DB. Der Server liefert langfristig nur Preisdaten und synchronisiert User-/Investment-Daten.

## Datei

- Runtime: Electron `app.getPath("userData") + "/cs-investor-hub.sqlite"`
- Zugriff: nur Electron Main Process
- Renderer: nur ueber `window.electronAPI.localStore`

## Tabellen

- `meta`: Schema-/Client-Metadaten.
- `items`: Lokale Item-Stammdaten und optionale Server-ID.
- `investments`: Lokale Investments mit `dirty`, `revision`, `deleted` fuer Sync.
- `watchlist_items`: Lokale Watchlist mit `dirty`, `revision`, `deleted` fuer Sync.
- `item_prices`: Letzter bekannter Preis pro Item.
- `price_history`: Historische Itempreise.
- `portfolio_snapshots`: Lokale Portfolio-Snapshots.
- `operations_log`: Idempotente Aenderungsqueue fuer spaeteren Push-Sync.

## Regeln

- Renderer darf SQLite nie direkt oeffnen.
- Lokale Schreibaktionen erzeugen immer einen `operations_log`-Eintrag.
- Server-IDs sind optional; lokale IDs sind stabile UUIDs.
- Deletes sind soft deletes (`deleted = 1`), damit Sync sie pushen kann.
- Preise sind server-/providerseitige Daten und werden lokal nur gespiegelt.

## Naechster Schritt

Die Shared-Hooks werden schrittweise auf eine Runtime-Data-Source umgestellt:

- Desktop: `window.electronAPI.localStore`
- Web: `apiClient`

## Aktueller Read Path

- `packages/shared/src/lib/dataSource.js` entscheidet zur Laufzeit zwischen Desktop-Store und Web/API.
- `usePortfolio` liest im Desktop zuerst aus SQLite.
- Wenn die lokale Investment-Tabelle leer ist, wird einmal aus dem Backend gelesen und mit `importInvestments` in SQLite geseedet.
- Imports erzeugen keine `operations_log`-Eintraege; nur lokale Schreibaktionen tun das.
