# Fahrtenbuch API 1.0

Diese Dateien implementieren die vollständige REST-API aus `api/openapi.yml` für das vorhandene Fahrtenbuch-Projekt.

## Umfang

Enthalten sind alle **74 dokumentierten API-Operationen** aus den Bereichen:

- Systemstatus
- Login, Token-Refresh und Logout
- Passwort-Reset
- TOTP-MFA
- Passkeys/WebAuthn
- QR-App-Pairing und Geräteverwaltung
- Benutzer
- Fahrzeuge einschließlich Bluetooth-Zuordnung
- Fahrten, Klassifizierung, Tags und Trackpunkte
- Offline-taugliches Tracking in Punkt-Batches
- Dashboard und Statistiken
- Karten-, Photon- und Overpass-Konfiguration
- Geocoding und Umkreissuche
- persönliche Einstellungen
- CSV-, GPX- und PDF-Export
- CSV- und GPX-Import
- Benutzer- und Systemadministration
- JSON/GZIP-Datenbankbackup

Die Datei `API_COVERAGE.md` führt alle Operationen einzeln auf.

## Verzeichnisinhalt

```text
.
├── .env.api.example
├── API_COVERAGE.md
├── README_API.md
├── api/
│   └── openapi.yml
├── docker-compose.api.example.yml
├── database/
│   └── migrations/
│       ├── 0001_initial.sql
│       └── 0002_complete_api.sql
└── backend/
    ├── openapi.yml
    ├── package.json
    ├── scripts/
    └── src/
```

## In das bestehende Repository übernehmen

Den Inhalt dieses Archivs in den Root-Ordner des Fahrtenbuch-Repositories kopieren. Bestehende Backend-Dateien werden dabei ersetzt. Frontend-Dateien sind in diesem Paket nicht enthalten.

Danach im Projekt-Root ausführen:

```bash
npm install
npm run check --workspace backend
```

`npm install` aktualisiert die zentrale `package-lock.json` des npm-Workspaces. Diese Lock-Datei muss mit committed werden.

## Datenbankmigration

`0002_complete_api.sql` erweitert das vorhandene Schema unter anderem um:

- VIN und Notizen bei Fahrzeugen
- externe Geräte-ID für die Android-App
- zusätzliche Indizes
- Backup-Aufträge
- Standardkonfiguration für Karte, Photon und Overpass

Die vorhandene Datenbank muss **nicht gelöscht** werden. Beim Start führt `runMigrations()` nur noch nicht registrierte Migrationen aus.

Bei einer bestehenden Installation müssen beide Dateien im Image unter diesem Pfad liegen:

```text
/app/database/migrations/
```

## Erforderliche Konfiguration

`.env.api.example` enthält alle Werte. Für den produktiven Start sind besonders wichtig:

```dotenv
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=fahrtenbuch
POSTGRES_USER=fahrtenbuch
POSTGRES_PASSWORD=...

JWT_ACCESS_SECRET=...
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
JWT_ISSUER=fahrtenbuch
JWT_AUDIENCE=fahrtenbuch-app

PUBLIC_BASE_URL=https://fahrtenbuch.example.de
TOTP_ENCRYPTION_KEY=...
RP_NAME=Fahrtenbuch
RP_ID=fahrtenbuch.example.de
RP_ORIGIN=https://fahrtenbuch.example.de

MIGRATIONS_DIR=/app/database/migrations
STATIC_DIR=/app/frontend/dist
BACKUP_DIR=/data/backups
```

Für Secrets sollten lange, zufällige Werte verwendet werden. Beispiel:

```bash
openssl rand -base64 48
```

## Passkeys und Pairing

Passkeys funktionieren nur zuverlässig über HTTPS. Folgende Werte müssen zur tatsächlichen Domain passen:

```dotenv
PUBLIC_BASE_URL=https://fahrtenbuch.example.de
RP_ID=fahrtenbuch.example.de
RP_ORIGIN=https://fahrtenbuch.example.de
```

Der QR-Pairing-Code enthält Serveradresse, Pair-ID, Pair-Token, Benutzername, E-Mail-Adresse und Ablaufzeit. Die Standardgültigkeit beträgt 120 Sekunden und ist über die Admin-Einstellungen änderbar.

## Passwort-Reset

Der Endpunkt nimmt Anfragen immer neutral an, damit nicht erkennbar ist, ob eine E-Mail-Adresse existiert.

Für den Versand kann ein Webhook konfiguriert werden:

```dotenv
PASSWORD_RESET_WEBHOOK_URL=https://automation.example.de/webhook/password-reset
```

Der Webhook erhält JSON mit `email`, `token`, `resetUrl` und `expiresAt`. Bei `DEBUG=true` liefert die API den Token zusätzlich als `debugResetToken`; das sollte nur in einer Entwicklungsumgebung verwendet werden.

## Android-App anbinden

Basis-URL:

```text
https://fahrtenbuch.example.de/api/v1
```

Login-Beispiel:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "identifier": "admin@example.de",
  "password": "...",
  "deviceName": "Android-App",
  "platform": "android",
  "appVersion": "1.0.0"
}
```

Geschützte Endpunkte verwenden:

```http
Authorization: Bearer <accessToken>
```

Das Access-Token ist kurzlebig. Die App sollte das Refresh-Token sicher speichern und über `POST /auth/refresh` rotieren. Nach einer erfolgreichen Rotation darf das alte Refresh-Token nicht erneut verwendet werden.

## API-Datei abrufen

Bei laufendem Server steht die Spezifikation zusätzlich hier bereit:

```text
GET /api/v1/openapi.yml
```

## Prüfungen

```bash
npm run check --workspace backend
```

Die Prüfung kontrolliert:

- erforderliche Dateien
- vollständige Pfad- und Methodenabdeckung der OpenAPI-Datei
- 74 von 74 dokumentierten Operationen

Zusätzlich wurden alle JavaScript-Dateien mit `node --check` geprüft. Ein vollständiger Integrationstest mit einer realen PostgreSQL-Instanz muss nach dem Einspielen in der Zielumgebung erfolgen.

## Persistenter Backup-Speicher

Der Backup-Endpunkt schreibt Dateien nach `/data/backups`. Damit sie beim Austausch des App-Containers erhalten bleiben, kann der Inhalt von `docker-compose.api.example.yml` in die bestehende Compose-Datei übernommen werden.

## Bereitstellung

```bash
git add backend database api .env.api.example API_COVERAGE.md README_API.md package-lock.json
git commit -m "Implement complete Fahrtenbuch API"
git push origin main
```

Nach erfolgreichem Image-Build auf dem Server:

```bash
docker compose pull
docker compose up -d --force-recreate
docker logs --tail 200 fahrtenbuch-app
```

Gesundheitsprüfung:

```bash
curl -s http://127.0.0.1:3000/api/v1/health
```
