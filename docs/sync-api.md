# Sync API Contract

Ziel: Minimaler Vertrag fuer den bidirektionalen Desktop-Sync zwischen Electron-Client und PHP-Backend.

## Zweck

- Desktop pusht lokale Aenderungen zum Server.
- Desktop pullt serverseitige Aenderungen vom letzten Sync-Zeitpunkt.
- Web/PWA liest nur read-only; keine direkten CSFloat- oder Steam-Imports.

## Endpunkte

### `GET /api/v1/sync/pull?since=TIMESTAMP`

Liefert alle serverseitigen Aenderungen seit `since`.

**Response (vereinfachtes Schema):**
```json
{
  "serverTime": "2026-05-04T12:00:00Z",
  "changes": [
    {
      "table": "investments",
      "id": "uuid",
      "op": "upsert",
      "payload": {},
      "serverRevision": 3,
      "updatedAt": "2026-05-04T11:58:00Z"
    }
  ]
}
```

### `POST /api/v1/sync/push`

Nimmt lokale Aenderungen vom Desktop entgegen.

**Request (vereinfachtes Schema):**
```json
{
  "clientId": "desktop-client-id",
  "changes": [
    {
      "op": "upsert",
      "table": "investments",
      "id": "uuid",
      "payload": {},
      "clientRevision": 2,
      "idempotencyKey": "uuid",
      "ts": "2026-05-04T11:58:00Z"
    }
  ]
}
```

**Response (vereinfachtes Schema):**
```json
{
  "results": [
    {
      "status": "applied",
      "serverRevision": 3
    }
  ]
}
```

## Regeln

- Desktop schreibt lokal zuerst und synchronisiert spaeter.
- Sync muss idempotent sein.
- Konflikte werden markiert und nicht still ueberschrieben.
- Business-Logik bleibt in PHP bzw. `packages/shared`.
- `investments.payload.bucket` (`investment`|`inventory`) wird als fachliche Zuordnung mitgesynct.
- Watchlist-Zielpreise (`alertPriceUsd`, `alertDirection`, `alertAnchorPriceUsd`,
  `alertTriggeredAt`) werden mitgesynct. Serverseitig landet der Preis in
  `watchlist.alert_price_usd`, die drei Metafelder in `watchlist.alert_meta_json`.
  `SyncEntityService::mergeTargetFieldsForWatchlistSync` traegt bestehende Werte
  vor, wenn der eingehende Payload die Felder nicht nennt — ohne diesen Merge
  wuerde jeder Push eines aelteren Clients einen auf einem anderen Geraet
  gesetzten Zielpreis loeschen.

## Implementierungsstand (2026-05-05)

- `GET /api/v1/sync/pull` und `POST /api/v1/sync/push` sind in `backend/public/index.php` registriert.
- Push-Validierung akzeptiert die Tabellen `investments`, `watchlist_items` und `sales`.

### Verkäufe (`sales`)

- Entity-Typ im lokalen `operations_log`: `sale`; `mapOperationToSyncChange`
  bildet ihn auf die Tabelle `sales` ab.
- **Die Zuordnungen (`allocations`) reisen im Payload mit.** Das Desktop rechnet
  FIFO und schickt das Ergebnis; das ziehende Gerät übernimmt es unverändert,
  statt es neu abzuleiten. So stimmen beide Seiten beim realisierten Gewinn per
  Konstruktion überein und nicht, weil zwei Ableitungen zufällig gleich ausgehen.
- Identität: über `(user_id, platform, external_trade_id)` — anders als bei
  `investments`, wo `user_id` im Schlüssel fehlt. Ohne den Scope kollidieren zwei
  Konten mit gleichem Paar auf einer Zeile, und `ON DUPLICATE KEY UPDATE` würde
  den Verkauf des anderen Kontos überschreiben. Server, die die Tabelle vor
  dieser Änderung angelegt haben, werden von `ensureUserScopedTradeKey()`
  nachgezogen; schlägt das fehl (etwa wegen einer Dublette unter dem engeren
  Schlüssel), bleibt der alte Schlüssel bestehen und der Sync läuft weiter.
  Die lokale UUID springt als `external_trade_id` ein, wenn der Verkauf keine
  echte Marktplatz-Trade-ID trägt; ein erneuter Push aktualisiert damit, statt zu
  duplizieren.
- Übersprungene Zuordnungen werden **gezählt und gemeldet**, nicht verschwiegen:
  `applySaleChange` schreibt `allocationsProjected` und `allocationsUnresolved`
  in den Payload (persistiert in `sync_entities`, kommt beim nächsten Pull
  zurück), und bei `unresolved > 0` protokolliert
  `Logger::warning('sync.sale.allocations_unresolved', …)` mit den betroffenen
  lokalen IDs. Ohne das wäre ein serverseitig zu niedriger realisierter Gewinn
  unsichtbar — es gibt keinen Lesepfad für Verkäufe auf dem Server.
  **Offen:** eine nicht auflösbare Zuordnung wird derzeit nicht automatisch
  erneut versucht. Der Fall ist eng (Push läuft ältest-zuerst, die Kaufzeile
  wird vor dem Verkauf geschrieben), tritt aber auf, wenn beide in einem Lauf
  entstehen und der Verkauf in einem früheren 200er-Fenster landet.
- Die Projektion der Zuordnungen in die Domänentabelle ist **best effort**:
  `sale_allocations.investment_id` ist ein INT-Fremdschlüssel, das Desktop
  adressiert Kaufzeilen aber per UUID. Die Brücke ist `sync_entities`
  (`payload_json.serverId` der Investment-Zeile). Ist die Kaufzeile noch nicht
  gesynct, wird die Zuordnung übersprungen statt der Push abgebrochen — der
  Payload behält sie, es geht also nichts verloren.
- **Ein Client kann neuer sein als der Server.** Die App aktualisiert sich
  selbst, der Server wird getrennt deployt. Kennt der Server eine Tabelle noch
  nicht, beantwortet er den Push mit **400 für den gesamten Stapel**
  (`SYNC_PUSH_INVALID_REQUEST — Invalid table at index N: <tabelle>`) — eine
  einzelne unbekannte Änderung würde also alle Investment- und
  Watchlist-Änderungen dahinter blockieren, im Minutentakt wiederholt.
  `desktopSync` liest die Tabelle aus der Fehlermeldung, merkt sie sich für die
  Sitzung und **hält nur diese Operationen zurück**; der Rest des Stapels geht
  durch. Zurückgehalten heißt ausdrücklich *nicht* verworfen: anders als ein
  nicht abbildbarer Entity-Typ werden sie gültig, sobald der Server nachzieht,
  und bleiben so lange `pending`. Die Merkliste ist sitzungslokal, damit ein
  neu deployter Server ohne App-Neustart wieder versucht wird.
- `sale_allocations.buy_price_usd` wird beim Zuordnen kopiert, lokal wie auf dem
  Server. Die Verwaltung erlaubt, Einstandspreise nachträglich zu setzen; ein
  realisierter Gewinn darf sich dadurch nicht rückwirkend ändern.
- Idempotency wird serverseitig ueber `(user_id, idempotency_key)` erzwungen.
- Konflikte werden bei aelterer `clientRevision` als `status: "conflict"` je Change zurueckgegeben.
- Pull liefert `serverTime`, `changes` und `count`.

