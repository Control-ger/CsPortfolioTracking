# Fee Settings & Break-even Plan

Status: IN PROGRESS  
Updated: 2026-05-23  
Owner: backend + shared frontend

## 1. Ziel

Fee-Settings steuern die Netto-Berechnung fuer Portfolio/ROI/Break-even.

Verbindliche Produktregeln:
- Withdrawal Fee ist konfigurierbar.
- Default bleibt `2.5`.
- Brutto und Netto werden parallel angezeigt.
- `fundingMode` pro Investment wird beruecksichtigt (`cash_in` | `wallet_funded`).

## 2. Ist-Stand (bereits umgesetzt)

### 2.1 Backend API

Aktive Endpunkte:
- `GET /api/v1/settings/fees`
- `PUT /api/v1/settings/fees`

Implementierung:
- `backend/src/Http/Controller/SettingsController.php`
- `backend/src/Application/Service/FeeSettingsService.php`
- `backend/src/Infrastructure/Persistence/Repository/UserFeeSettingsRepository.php`

### 2.2 Datenmodell

`user_fee_settings` ist aktuell versionsbasiert pro User (nicht mehr Single-Row-MVP):
- `user_id`
- `fx_fee_percent`
- `seller_fee_percent`
- `withdrawal_fee`
- `deposit_fee`
- `deposit_fee_fixed`
- `valid_from`
- `valid_to`

Repository-Verhalten:
- `findCurrentByUserId(...)`
- `createNewVersion(...)` (schliesst alte Version und schreibt neue)

### 2.3 Portfolio-Berechnung

Verwendet in:
- `backend/src/Application/Service/PortfolioService.php`

Gelieferte Netto-Felder:
- `costBasisTotal`
- `costBasisUnit`
- `netPositionValue`
- `netProfitEuro`
- `netRoiPercent`
- `breakEvenPriceNet`
- `appliedFees`
- `fundingMode`

### 2.4 Frontend

Aktive UI:
- `packages/shared/src/pages/SettingsPage.jsx`
- `packages/shared/src/lib/apiClient.js` (`fetchFeeSettings`, `updateFeeSettings`)

Portfolio-Darstellung mit Nettofeldern:
- `packages/shared/src/pages/PortfolioPage.jsx`
- `packages/shared/src/components/ItemDetailPanel.jsx`
- `packages/shared/src/components/ItemDetailsModal.jsx`
- `packages/shared/src/components/InventoryTable.jsx`

## 3. API-Contract (Current)

### 3.1 `GET /api/v1/settings/fees`

Response:

```json
{
  "data": {
    "id": 123,
    "fxFeePercent": 0,
    "sellerFeePercent": 2,
    "withdrawalFeePercent": 2.5,
    "depositFeePercent": 2.8,
    "depositFeeFixedEur": 0.26,
    "source": "db"
  },
  "meta": {}
}
```

`source` ist `db` oder `defaults`.

### 3.2 `PUT /api/v1/settings/fees`

Accepted body keys:
- `fxFeePercent` oder `fx_fee_percent`
- `sellerFeePercent` oder `seller_fee_percent`
- `withdrawalFeePercent` oder `withdrawal_fee_percent`
- `depositFeePercent` oder `deposit_fee_percent`
- `depositFeeFixedEur` oder `deposit_fee_fixed_eur`

Validierung:
- Prozentwerte `0..100`
- Fixwert `>= 0`

Fehler:
- `400 SETTINGS_VALIDATION_FAILED`
- `500 SETTINGS_SAVE_FAILED`

## 4. Rechenlogik (Current)

### Brutto
- `grossSell = displayPrice * quantity`
- `grossProfit = grossSell - totalInvested`
- `grossRoi = grossProfit / totalInvested`

### Netto
- `sellerFee = grossSell * sellerFeePercent`
- `afterSeller = grossSell - sellerFee`
- `withdrawFee = afterSeller * withdrawalFeePercent`
- `netProceeds = afterSeller - withdrawFee`

Acquisition/Cost-Basis:
- `wallet_funded`: keine zusaetzlichen Deposit/FX-Aufschlaege
- `cash_in`: Deposit/FX/Fixkosten werden auf Cost-Basis addiert

## 5. Offene Punkte (IN PROGRESS)

1. API-Contract und Architekturdocs auf dieselben Feldbezeichnungen final harmonisieren (insb. interne DB-Namen vs. API-Namen).
2. Testabdeckung fuer Fee-Versionierung (`valid_from`/`valid_to`) und Rechenregeln erweitern.
3. UI-Regressionstests fuer Nettoanzeige in allen Views (Overview, Inventory, Detail) festziehen.
4. Optional: Historisierung/Visualisierung von Fee-Profil-Aenderungen fuer User ergaenzen.

## 6. Verbindliche UI-Regel

Neue Settings/Portfolio-UI fuer dieses Thema nutzt nur bestehende shadcn-basierte UI-Bausteine aus:
- `packages/shared/src/components/ui/*`

Keine zusaetzliche UI-Library fuer Fee-Settings/Break-even.

## 7. Akzeptanzkriterien

1. `GET /api/v1/settings/fees` liefert ohne Seed valide Defaults.
2. `PUT /api/v1/settings/fees` validiert und persistiert neue Versionen.
3. Portfolio liefert Brutto + Netto parallel pro Position und Summary.
4. `fundingMode` wirkt auf Cost-Basis/Netto-Berechnung.
5. Frontend liest/schreibt Settings ueber `packages/shared/src/lib/apiClient.js` und rendert konsistent.
