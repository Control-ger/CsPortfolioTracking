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

