# Fahrtenbuch

Ein modernes, selbst gehostetes Fahrtenbuch für Privatpersonen und Unternehmen.

Das Projekt besteht aus einer React-Weboberfläche, einer nativen Android-App und einem Express/PostgreSQL-Backend. Ziel ist eine moderne, schnelle und datenschutzfreundliche Alternative zu kommerziellen Fahrtenbüchern – mit vollständiger Kontrolle über die eigenen Daten.

---

# Features

## Fahrten

- automatische Fahrterkennung
- Live-GPS-Aufzeichnung
- manuelle Fahrten
- Privat- und Geschäftsfahrten
- Fahrten nachträglich bearbeiten
- Zwischenstopps
- Kilometerberechnung
- Fahrtdauer
- Durchschnittsgeschwindigkeit
- Kartenansicht
- GPX-Export
- CSV-Export
- PDF-Export

---

## Fahrzeuge

- beliebig viele Fahrzeuge
- Bluetooth-Erkennung
- automatischer Fahrzeugwechsel
- Kennzeichen
- VIN
- Kilometerstand
- Farbe
- Notizen

---

## Android App

- automatische Aufzeichnung
- Hintergrunddienst
- Bluetooth-Erkennung
- GPS-Aufzeichnung
- Offlinebetrieb
- automatische Synchronisation
- Material Design 3
- Dark Mode
- Android Auto
- Anmeldung per QR-Code

---

## Weboberfläche

- große Kartenansicht
- modernes Dashboard
- responsive Design
- Dark Mode
- Cloudflare-inspiriertes Theme
- Statistiken
- Benutzerverwaltung
- Adminbereich

---

## Sicherheit

- JWT
- Refresh Tokens
- Passkeys
- TOTP
- Geräteverwaltung
- QR-Code-Pairing
- HTTPS
- Rollenverwaltung

---

# Screenshots

*folgen*

---

# Projektstruktur

```text
fahrtenbuch/
│
├── backend/
├── frontend/
├── android/
├── shared/
├── db/
├── docs/
├── .github/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── LICENSE
└── README.md
```

---

# Shared Package

Das Projekt verwendet ein gemeinsames Paket:

```text
shared/
```

Dieses Paket wird von Backend, Weboberfläche und zukünftig auch von Android verwendet.

## Inhalt

- Datenmodelle
- DTOs
- Enums
- Konstanten
- Validierungen
- Hilfsfunktionen
- OpenAPI-Spezifikation

Dadurch existieren alle gemeinsamen Strukturen nur einmal und können von sämtlichen Clients verwendet werden.

---

# Technologie

## Frontend

- React
- Vite
- Tailwind CSS
- Leaflet
- React Router
- TanStack Query

## Backend

- Node.js
- Express
- PostgreSQL
- JWT
- Swagger / OpenAPI

## Android

- Kotlin
- Jetpack Compose
- Material Design 3
- WorkManager
- Foreground Service
- Android Auto

---

# API

Die REST-API ist unter folgendem Pfad erreichbar:

```text
/api/v1
```

Swagger steht unter

```text
/swagger
```

zur Verfügung, wenn

```text
DEBUG=true
```

gesetzt ist.

---

# Installation

## Repository klonen

```bash
git clone https://github.com/cheinisch/fahrtenbuch.git

cd fahrtenbuch
```

## Konfiguration

```bash
cp .env.example .env
```

Anschließend die Datenbankverbindung und weitere Einstellungen in der `.env` anpassen.

## Docker

```bash
docker compose up -d
```

Danach ist die Anwendung unter

```text
http://localhost
```

erreichbar.

---

# Entwicklung

## Frontend

```bash
cd frontend

npm install

npm run dev
```

## Backend

```bash
cd backend

npm install

npm run dev
```

## Android

Das Projekt mit Android Studio öffnen:

```text
android/
```

---

# Datenbankmigrationen

```text
db/Migration/
```

Aktuelle Migrationen:

```text
001_initial.sql
002_auth_admin.sql
003_mfa_passkeys.sql
004_api_v1.sql
005_vehicle_bluetooth.sql
006_app_pairing.sql
```

---

# QR-Code-Anmeldung

Die Anmeldung der Android-App erfolgt vollständig über einen QR-Code.

Ablauf:

1. Im Web auf **App verbinden** klicken.
2. QR-Code wird erzeugt.
3. Android-App scannt den QR-Code.
4. Sichere Authentifizierung.
5. Tokens werden lokal gespeichert.
6. Das Gerät erscheint in der Geräteverwaltung.

---

# Geräteverwaltung

Im Profil können alle angemeldeten Geräte verwaltet werden.

Folgende Informationen stehen zur Verfügung:

- Gerätename
- Plattform
- App-Version
- Letzte Nutzung

Folgende Aktionen sind möglich:

- Gerät entfernen
- Gerät umbenennen

---

# Theme

Das Standard-Theme orientiert sich an der Farbwelt von Cloudflare.

Unterstützt werden:

- Hell
- Dunkel
- System

---

# GitHub Actions

Bei jedem Push wird automatisch ein Docker-Image erstellt und in der GitHub Container Registry veröffentlicht.

Aktuelles Entwicklungsimage:

```text
ghcr.io/cheinisch/fahrtenbuch:dev
```

Zusätzlich erhält jeder Commit einen eigenen Tag, beispielsweise:

```text
ghcr.io/cheinisch/fahrtenbuch:dev-a1b2c3d
```

---

# Roadmap

## Version 1.0

- Fahrten
- Fahrzeuge
- Android-App
- Kartenansicht
- Statistiken
- PDF-Export
- CSV-Export
- GPX-Export

## Version 1.1

- OBD-Unterstützung
- Tankbuch
- Wartungen
- Erinnerungen

## Version 1.2

- Wear OS
- iOS-App
- Apple Watch
- Apple CarPlay

## Version 2.0

- Teams
- Flottenverwaltung
- Freigaben
- Webhooks
- Integrationen

---

# Lizenz

Dieses Projekt steht unter der **GNU Affero General Public License v3.0 (AGPL-3.0)**.

Kurz zusammengefasst bedeutet das:

- Das Projekt darf privat und kommerziell genutzt werden.
- Der Quellcode darf verändert werden.
- Das Projekt darf weitergegeben werden.
- Das Projekt darf selbst gehostet werden.
- Kostenpflichtige Dienstleistungen rund um das Projekt sind erlaubt.
- Werden Änderungen an der Software über einen Netzwerkdienst (z. B. als Webanwendung) bereitgestellt, muss der vollständige Quellcode dieser Änderungen ebenfalls unter der AGPL-3.0 veröffentlicht werden.
- Copyright- und Lizenzhinweise müssen erhalten bleiben.

Der vollständige Lizenztext befindet sich in der Datei `LICENSE`.

SPDX-Identifier:

```text
AGPL-3.0-only
```

---

# Mitwirken

Beiträge sind herzlich willkommen.

Wenn du Fehler findest oder Ideen für neue Funktionen hast, eröffne gerne ein Issue oder sende einen Pull Request.

Bitte beachte dabei die Coding-Guidelines und halte Pull Requests möglichst klein und thematisch fokussiert.

---

# Autor

**Christian Heinisch**

GitHub: https://github.com/cheinisch
