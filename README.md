# CS Investor Hub

## Disclaimer / Haftungsausschluss

Dieses Projekt wurde zu Bildungs- und Portfoliozwecken erstellt.
- Keine Finanzberatung: Angezeigte Daten und Berechnungen dienen nur der Information.
- Kein Support: Das Repository wird "as-is" bereitgestellt.
- Nutzung auf eigene Gefahr: Verwendung von API-Schnittstellen und Code erfolgt auf eigenes Risiko.

## Screenshots

### Desktop App (Dark Mode)

![Welcome (Dark)](docs/screenshots/electron-native-fixed/00-welcome.png)
![Dashboard Overview (Dark)](docs/screenshots/electron-native-fixed/01-dashboard-overview.png)
![Inventar Item Details (Dark)](docs/screenshots/electron-native-fixed/09-inventory-item-details.png)
![Watchlist Item Details (Dark)](docs/screenshots/electron-native-fixed/10-watchlist-item-details.png)
![Verwaltung (Dark)](docs/screenshots/electron-native-fixed/07-tab-verwaltung.png)
![Settings (Dark)](docs/screenshots/electron-native-fixed/08-settings.png)

### Desktop App (Light Mode)

![Dashboard Overview (Light)](docs/screenshots/electron-native-light/01-dashboard-overview-light.png)
![Settings (Light)](docs/screenshots/electron-native-light/06-settings-light.png)
![Watchlist Item Details (Light)](docs/screenshots/electron-native-light/09-watchlist-item-details-light.png)

## Installation / Setup

1. Abhaengigkeiten installieren:
```bash
npm install
```

2. Lokale Env-Datei anlegen:
```powershell
Copy-Item .env.example .env
```

3. `.env` konfigurieren (mindestens relevante DB/API-Werte fuellen).

## npm run Befehle

```bash
npm run dev
npm run build
npm run lint
npm run docs:guard
```
