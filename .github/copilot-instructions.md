# Copilot Instructions

Diese Datei definiert repo-weite Arbeitsregeln fuer Copilot in diesem Projekt.

## Pflicht-Start fuer jede Session

1. Zuerst `AGENTS.md` lesen — sie ist die einzige Wahrheit.
2. `README.md` nur für Setup/Install-Befehle konsultieren, nicht für Architektur.
3. Bei Backend-Aenderungen zuerst `backend/public/index.php` und die betroffenen Service-/Repository-Dateien pruefen.

## Arbeitsprinzipien

- Aendere nur, was fuer die Aufgabe noetig ist (minimal-invasiv).
- Vorhandene Architekturregeln aus `AGENTS.md` haben Vorrang.
- Multi-User-Kontext sauber beachten (`userId` propagieren).
- Persistenzregeln beachten: USD speichern, EUR zur Laufzeit berechnen.
- Item-Verknuepfungen ueber `item_id`, nicht ueber Namensvergleiche.

## Konsistenzpflicht bei Struktur-Aenderungen

Wenn sich eine der folgenden Grundlagen aendert, muss `AGENTS.md` im selben Commit aktualisiert werden:

- Top-Level-Struktur oder zentrale Ordner
- Service/Repository/Controller-Boundaries
- verbindliche Datenmodellregeln
- Auth-/Session-Strategie

## Dokumentationspflicht bei globalen Aenderungen

Bei globalen/architekturellen Aenderungen gilt zusaetzlich:
- `docs/architecture-overview.md` im selben Commit aktualisieren
- neue oder verschobene zentrale `.md`-Dateien in `AGENTS.md` registrieren

Vor dem Push:
- `npm run docs:guard` ausfuehren

CI:
- Der Workflow `.github/workflows/docs-governance.yml` validiert diese Regeln automatisch.

## Erwartetes Vorgehen bei Antworten

- Kurz begruenden, welche Dateien warum geaendert werden.
- Pfade immer explizit nennen.
- Nach nicht-trivialen Aenderungen passende Verifikation vorschlagen oder ausfuehren.

