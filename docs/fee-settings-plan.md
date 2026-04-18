# Fee-Settings & Break-even Plan (Mini-PRD fuer Coding-Agent)

## 1. Zielbild
Wir fuehren manuelle Fee-Settings ein, damit Break-even und ROI realistisch berechnet werden.

**Verbindliche Produktentscheidungen:**
- Withdrawal Fee ist in User-Settings frei konfigurierbar.
- Default fuer Withdrawal Fee ist `2.5%`.
- Portfolio zeigt Brutto- und Netto-Kennzahlen parallel.
- Funding Mode wird pro Investment gespeichert.

**Verbindliche UI-Regel:**
- Neue UI wird ausschliesslich mit `shadcn/ui` aus `src/components/ui/*` gebaut.
- Keine zusaetzliche UI-Library fuer dieses Feature.

## 2. Scope

### MVP (1-2 Tage)
- Fee-Settings API (GET/PUT) bereitstellen.
- Datenhaltung fuer Fee-Settings und `funding_mode` auf Investments einfuehren.
- Portfolio-Berechnung um Netto-Kennzahlen erweitern.
- Settings-Seite mit shadcn-Formularen anbinden.
- Portfolio-Komponenten zeigen Brutto+Netto parallel.

### Nicht-Ziele im MVP
- Kein automatischer CSFloat-Fee-Sync.
- Kein Multi-User/Auth-Refactor.
- Kein komplettes Portfolio-Redesign.

### V2 (perspektivisch)
- Tiered Withdrawal presets.
- Automatisierter CSFloat Fee-Sync via Feature Flag mit Fallback auf manuelle Werte.

## 3. Datenmodell

### 3.1 Neue Tabelle `user_fee_settings`
- `id` INT PK
- `fx_fee_percent` DECIMAL(5,2) NOT NULL DEFAULT 0.00
- `seller_fee_percent` DECIMAL(5,2) NOT NULL DEFAULT 2.00
- `withdrawal_fee_percent` DECIMAL(5,2) NOT NULL DEFAULT 2.50
- `deposit_fee_percent` DECIMAL(5,2) NOT NULL DEFAULT 2.80
- `deposit_fee_fixed_eur` DECIMAL(10,2) NOT NULL DEFAULT 0.26
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP

Hinweis: MVP als Single-Row (`id=1`), spaeter erweiterbar um `user_id`.

### 3.2 Erweiterung `investments`
- Neue Spalte `funding_mode` VARCHAR(32) NOT NULL DEFAULT `'wallet_funded'`
- Erlaubte Werte:
  - `cash_in`
  - `wallet_funded`

## 4. API-Vertraege

### 4.1 GET `/api/v1/settings/fees`
Antwort:

```json
{
  "data": {
    "fxFeePercent": 0,
    "sellerFeePercent": 2,
    "withdrawalFeePercent": 2.5,
    "depositFeePercent": 2.8,
    "depositFeeFixedEur": 0.26,
    "source": "defaults"
  },
  "meta": {}
}
```

`source` ist `defaults` oder `db`.

### 4.2 PUT `/api/v1/settings/fees`
Request:

```json
{
  "fxFeePercent": 1.0,
  "sellerFeePercent": 2.0,
  "withdrawalFeePercent": 2.5,
  "depositFeePercent": 2.8,
  "depositFeeFixedEur": 0.26
}
```

Validierung:
- Prozentwerte: `0..100`
- Fixwert in EUR: `>= 0`

Fehlercodes:
- `400 SETTINGS_VALIDATION_FAILED`
- `500 SETTINGS_SAVE_FAILED`

### 4.3 Erweiterte Portfolio-Responses
`GET /api/v1/portfolio/investments` liefert additiv:
- `fundingMode`
- `netProceeds`
- `netProfitEuro`
- `netRoiPercent`
- `breakEvenPriceNet`
- `appliedFees`

`GET /api/v1/portfolio/summary` liefert additiv:
- `totalNetValue`
- `totalNetProfitEuro`
- `totalNetRoiPercent`

Wichtig: Bestehende Bruttofelder bleiben unveraendert (backward compatible).

## 5. Rechenlogik (Backend)

### 5.1 Brutto (bestehend)
- `grossSell = livePrice * quantity`
- `grossProfit = grossSell - buyTotal`
- `grossRoi = grossProfit / buyTotal`

### 5.2 Netto (neu)
- `sellerFee = grossSell * sellerFeePercent`
- `afterSeller = grossSell - sellerFee`
- `withdrawFee = afterSeller * withdrawalFeePercent`
- `netProceeds = afterSeller - withdrawFee`

Cost Basis je Funding Mode:
- `wallet_funded`: kein neuer Deposit-/FX-Aufschlag
- `cash_in`: Deposit-/FX-Anteil auf Cost Basis addieren

Pro Position liefern:
- `netProceeds`
- `netProfitEuro`
- `netRoiPercent`
- `breakEvenPriceNet`
- `appliedFees`
- `fundingMode`

## 6. Implementierungsplan mit Dateipfaden

### 6.1 Backend
1. Neues Repository anlegen:
   - `backend/src/Infrastructure/Persistence/Repository/UserFeeSettingsRepository.php`
   - Methoden: `ensureTable()`, `findOrDefault()`, `upsert()`
2. Settings-Service anlegen:
   - `backend/src/Application/Service/FeeSettingsService.php`
3. Settings-Controller anlegen:
   - `backend/src/Http/Controller/SettingsController.php`
4. Routing/Bootstrap erweitern:
   - `backend/src/Shared/Http/Router.php`
   - `backend/public/index.php`
5. Portfolio-Berechnung erweitern:
   - `backend/src/Application/Service/PortfolioService.php`
6. Investment-Repository um Funding Mode erweitern:
   - `backend/src/Infrastructure/Persistence/Repository/InvestmentRepository.php`
7. API-Dokumentation aktualisieren:
   - `backend/MVC_API_CONTRACT.md`

### 6.2 Frontend (nur shadcn/ui)
1. API-Client erweitern:
   - `src/lib/apiClient.js` (`fetchFeeSettings`, `updateFeeSettings`)
2. Settings-Seite implementieren:
   - `src/pages/SettingsPage.jsx`
   - Verwende nur Komponenten aus `src/components/ui/*` (`card`, `input`, `button`, `select`, `badge`)
3. Portfolio-Anzeige erweitern (Brutto/Netto parallel):
   - `src/pages/PortfolioPage.jsx`
   - `src/components/InventoryTable.jsx`
   - `src/components/ItemDetailPanel.jsx`
4. Optional Summary-Karten erweitern:
   - `src/components/StatsCards.jsx`

## 7. Migration & Backward Compatibility
1. Tabelle `user_fee_settings` sicher erstellen (idempotent).
2. Spalte `investments.funding_mode` sicher erstellen (idempotent).
3. Altdaten-Fallback:
   - fehlender Funding Mode => `wallet_funded`
   - fehlende Settings-Row => Defaults inkl. `withdrawalFeePercent=2.5`
4. Additive API-Aenderungen: keine bestehenden Felder entfernen/umbenennen.

## 8. Akzeptanzkriterien
- `GET /api/v1/settings/fees` liefert ohne Seed gueltige Defaults.
- `PUT /api/v1/settings/fees` speichert Werte und validiert Grenzwerte.
- Portfolio liefert Brutto + Netto parallel pro Position und Summary.
- Funding Mode ist pro Investment sichtbar (`cash_in`/`wallet_funded`).
- Neue UI verwendet ausschliesslich `shadcn/ui`-Komponenten.

## 9. Testplan

### 9.1 Backend
- Validierung: Prozent `<0`/`>100`, EUR `<0`, nicht numerisch.
- Default-Fallback ohne Settings-Datensatz.
- Berechnungstests:
  - Seller Fee only
  - Seller + Withdrawal
  - `cash_in` vs `wallet_funded`
  - Break-even Netto gegen Referenzwerte

### 9.2 Frontend
- Settings laden/speichern/fehlerfall.
- Brutto+Netto parallel korrekt gerendert.
- Funding Mode sichtbar pro Investment.
- UI-Komponenten stammen aus `src/components/ui/*`.

## 10. Rollout
1. Backend Schema + Settings API deployen.
2. Portfolio-Nettofelder backendseitig aktivieren.
3. Frontend Settings + Portfolio-Darstellung ausrollen.
4. Beobachtung ueber Logs/Telemetry und ggf. Hotfix fuer Rundungslogik.

## 11. Risiken
- Rundungsabweichungen bei Netto/Break-even.
- Inkonsistente Feldnamen zwischen API und Frontend Mapping.
- Teilweise alte Investment-Write-Pfade ohne `fundingMode`.

## 12. Offene Fragen
1. Sollen `depositFeePercent` und `depositFeeFixedEur` im MVP bereits editierbar sein oder nur backendseitig vorbereitet?
2. Netto-KPIs als eigene Karten oder in bestehenden Karten mit Doppelwert?
3. Funding Mode im MVP nur Anzeige oder auch im Investment-Edit aktiv aenderbar?

## 13. V2: Automatisierter CSFloat Fee-Sync
- Feature Flag: `FEATURE_FEE_SYNC_CSFLOAT`
- Sync-Job holt Fee-Snapshots, sofern Endpoint verfuegbar.
- Harte Regel: bei Fehler/keinem Endpoint immer Fallback auf manuelle Werte.
- UI zeigt aktive Quelle: `manual` oder `csfloat_snapshot`.

