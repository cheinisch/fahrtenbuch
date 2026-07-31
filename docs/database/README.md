# Datenbank

Die Datenbank verwendet PostgreSQL 16. Die Migrationen werden beim ersten Start des
PostgreSQL-Containers in numerischer Reihenfolge ausgeführt.

## Tabellenübersicht

### Benutzer und Sicherheit
- `users`
- `user_preferences`
- `refresh_tokens`
- `password_reset_tokens`
- `totp_credentials`
- `recovery_codes`
- `passkey_credentials`
- `devices`
- `pairings`
- `auth_events`
- `api_tokens`

### Fahrtenbuch
- `vehicles`
- `odometer_entries`
- `trips`
- `trip_points`
- `trip_stops`
- `trip_corrections`
- `tags`
- `trip_tags`
- `trip_comments`

### Infrastruktur
- `external_services`
- `geocoding_cache`
- `import_jobs`
- `export_jobs`
- `system_settings`
- `audit_log`

## Wichtige Regeln

- Ein Fahrzeug gehört genau einem Benutzer.
- Eine Fahrt darf nur ein Fahrzeug desselben Benutzers referenzieren.
- Pro Benutzer kann nur ein aktives Standardfahrzeug existieren.
- Bluetooth-MAC-Adressen sind systemweit eindeutig.
- Gelöschte Benutzer, Fahrzeuge und Fahrten werden über `deleted_at` logisch gelöscht.
- Abgeschlossene Fahrten können den Kilometerstand des Fahrzeugs automatisch erhöhen.
- Pairing-Codes sind zeitlich begrenzt; die Anwendung verwendet standardmäßig 120 Sekunden.
- Die Buildnummer ist nicht Bestandteil der Datenbank und wird nicht öffentlich ausgegeben.
