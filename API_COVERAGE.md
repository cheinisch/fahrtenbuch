# OpenAPI-Abdeckung

**Status: 74/74 dokumentierte Operationen implementiert.**

Die Prüfung erfolgt zusätzlich über:

```bash
npm run check --workspace backend
```

| Bereich | Methode | Pfad | Funktion | Bearer-Token |
|---|---:|---|---|:---:|
| Admin | `POST` | `/admin/backup` | Vollständiges Backup erstellen | Ja |
| Admin | `GET` | `/admin/settings/services` | Interne Kartendienst-Konfiguration abrufen | Ja |
| Admin | `PUT` | `/admin/settings/services/map` | Kartenquelle konfigurieren | Ja |
| Admin | `PUT` | `/admin/settings/services/overpass` | Overpass konfigurieren | Ja |
| Admin | `PUT` | `/admin/settings/services/photon` | Photon konfigurieren | Ja |
| Admin | `POST` | `/admin/settings/services/test` | Kartendienst-Verbindung testen | Ja |
| Admin | `GET` | `/admin/system` | Systeminformationen abrufen | Ja |
| Admin | `GET` | `/admin/users` | Benutzer auflisten | Ja |
| Admin | `POST` | `/admin/users` | Benutzer anlegen | Ja |
| Admin | `DELETE` | `/admin/users/{id}` | Benutzer löschen | Ja |
| Admin | `GET` | `/admin/users/{id}` | Benutzer abrufen | Ja |
| Admin | `PUT` | `/admin/users/{id}` | Benutzer aktualisieren | Ja |
| App Pairing | `POST` | `/auth/pair` | Gerät per QR-Code koppeln | Nein |
| App Pairing | `POST` | `/auth/pair/options` | QR-Pairing erzeugen | Ja |
| App Pairing | `DELETE` | `/auth/pair/{pairId}` | Pairing abbrechen | Ja |
| App Pairing | `GET` | `/auth/pair/{pairId}/status` | Pairing-Status abrufen | Ja |
| Auth | `POST` | `/auth/login` | Anmelden | Nein |
| Auth | `POST` | `/auth/logout` | Aktuelle Sitzung abmelden | Ja |
| Auth | `POST` | `/auth/logout-all` | Alle Sitzungen abmelden | Ja |
| Auth | `POST` | `/auth/password/forgot` | Passwort-Reset anfordern | Nein |
| Auth | `POST` | `/auth/password/reset` | Passwort zurücksetzen | Nein |
| Auth | `POST` | `/auth/refresh` | Access-Token erneuern | Nein |
| Dashboard | `GET` | `/dashboard` | Dashboarddaten abrufen | Ja |
| Devices | `GET` | `/users/me/devices` | Eigene Geräte auflisten | Ja |
| Devices | `DELETE` | `/users/me/devices/{deviceId}` | Gerät und zugehörige Sitzungen entfernen | Ja |
| Geocoding | `GET` | `/geocoding/nearby` | POIs über den konfigurierten Overpass-Dienst suchen | Ja |
| Geocoding | `GET` | `/geocoding/reverse` | Koordinaten über den konfigurierten Photon-Dienst auflösen | Ja |
| Geocoding | `GET` | `/geocoding/search` | Orte über den konfigurierten Photon-Dienst suchen | Ja |
| Import Export | `GET` | `/export/csv` | Fahrten als CSV exportieren | Ja |
| Import Export | `GET` | `/export/gpx` | Fahrten als GPX exportieren | Ja |
| Import Export | `GET` | `/export/pdf` | Fahrtenbuch als PDF exportieren | Ja |
| Import Export | `POST` | `/import/csv` | Fahrten aus CSV importieren | Ja |
| Import Export | `POST` | `/import/gpx` | GPX importieren | Ja |
| MFA | `DELETE` | `/auth/mfa/totp` | TOTP deaktivieren | Ja |
| MFA | `POST` | `/auth/mfa/totp/setup` | TOTP-Einrichtung starten | Ja |
| MFA | `POST` | `/auth/mfa/totp/verify` | TOTP aktivieren | Ja |
| Passkeys | `GET` | `/auth/passkeys` | Eigene Passkeys auflisten | Ja |
| Passkeys | `POST` | `/auth/passkeys/login/options` | Passkey-Anmeldeoptionen erzeugen | Nein |
| Passkeys | `POST` | `/auth/passkeys/login/verify` | Mit Passkey anmelden | Nein |
| Passkeys | `POST` | `/auth/passkeys/register/options` | Passkey-Registrierungsoptionen erzeugen | Ja |
| Passkeys | `POST` | `/auth/passkeys/register/verify` | Passkey registrieren | Ja |
| Passkeys | `DELETE` | `/auth/passkeys/{id}` | Passkey löschen | Ja |
| Services | `GET` | `/config/services` | Öffentliche Client-Konfiguration abrufen | Nein |
| Settings | `GET` | `/settings` | Eigene Einstellungen abrufen | Ja |
| Settings | `PUT` | `/settings` | Eigene Einstellungen aktualisieren | Ja |
| Statistics | `GET` | `/statistics` | Statistiken abrufen | Ja |
| Statistics | `GET` | `/statistics/monthly` | Monatsstatistik abrufen | Ja |
| Statistics | `GET` | `/statistics/vehicles` | Fahrzeugstatistik abrufen | Ja |
| System | `GET` | `/health` | Systemstatus abrufen | Nein |
| Tags | `GET` | `/tags` | Tags auflisten | Ja |
| Tags | `POST` | `/tags` | Tag anlegen | Ja |
| Tags | `DELETE` | `/tags/{id}` | Tag löschen | Ja |
| Tags | `PUT` | `/tags/{id}` | Tag aktualisieren | Ja |
| Tracking | `POST` | `/tracking/points` | GPS-Punkte hochladen | Ja |
| Tracking | `POST` | `/tracking/start` | Aufzeichnung starten | Ja |
| Tracking | `GET` | `/tracking/status` | Aktuellen Trackingstatus abrufen | Ja |
| Tracking | `POST` | `/tracking/stop` | Aufzeichnung beenden | Ja |
| Trips | `GET` | `/trips` | Fahrten auflisten | Ja |
| Trips | `POST` | `/trips` | Fahrt manuell anlegen | Ja |
| Trips | `DELETE` | `/trips/{id}` | Fahrt löschen | Ja |
| Trips | `GET` | `/trips/{id}` | Fahrt abrufen | Ja |
| Trips | `PUT` | `/trips/{id}` | Fahrt aktualisieren | Ja |
| Trips | `PUT` | `/trips/{id}/classify` | Fahrt klassifizieren | Ja |
| Trips | `GET` | `/trips/{id}/points` | GPS-Punkte einer Fahrt abrufen | Ja |
| Trips | `PUT` | `/trips/{id}/tags` | Tags einer Fahrt setzen | Ja |
| Users | `GET` | `/users/me` | Eigenes Profil abrufen | Ja |
| Users | `PUT` | `/users/me` | Eigenes Profil aktualisieren | Ja |
| Users | `PUT` | `/users/me/password` | Eigenes Passwort ändern | Ja |
| Vehicles | `GET` | `/vehicles` | Fahrzeuge auflisten | Ja |
| Vehicles | `POST` | `/vehicles` | Fahrzeug anlegen | Ja |
| Vehicles | `DELETE` | `/vehicles/{id}` | Fahrzeug löschen | Ja |
| Vehicles | `GET` | `/vehicles/{id}` | Fahrzeug abrufen | Ja |
| Vehicles | `PUT` | `/vehicles/{id}` | Fahrzeug aktualisieren | Ja |
| Vehicles | `PUT` | `/vehicles/{id}/bluetooth` | Bluetooth-Zuordnung aktualisieren | Ja |

## Zusätzliche Web-Kompatibilitätsrouten

Diese Routen sind nicht Bestandteil der hochgeladenen OpenAPI-Datei, bleiben aber für die aktuelle Weboberfläche verfügbar:

- `PATCH /users/me/profile`
- `POST /users/me/password`
- `GET /users/me/settings`
- `PATCH /users/me/settings`
- `POST /users/me/home-location/search`
- `POST /users/me/home-location/reverse`
- `PUT /users/me/home-location`
- `DELETE /users/me/home-location`
- `PATCH /admin/users/{id}`
- `GET /admin/overview`
- `GET /admin/settings`
- `PATCH /admin/settings`
