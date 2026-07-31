# ADR 0003: Relationale PostgreSQL-Datenbank

## Entscheidung

Das Fahrtenbuch verwendet PostgreSQL 16 mit UUID-Primärschlüsseln für fachliche
Entitäten und Identity-Spalten für große Ereignis- und Punktetabellen.

## Gründe

- saubere Datenintegrität durch Foreign Keys und Constraints
- gute Unterstützung für JSONB, IP-Adressen, MAC-Adressen und Zeitstempel
- effiziente Speicherung vieler Trackingpunkte
- klare Trennung zwischen Authentifizierung, Fahrten und Infrastruktur
- Soft-Delete für rechtlich und fachlich relevante Datensätze

## Löschregeln

- benutzerbezogene Daten werden überwiegend mit `ON DELETE CASCADE` entfernt
- Fahrzeuge mit vorhandenen Fahrten können nicht physisch gelöscht werden
- Audit-Einträge behalten ihre Historie und setzen Benutzerreferenzen auf NULL
