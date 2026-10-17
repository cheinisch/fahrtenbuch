# Changelog

Alle nennenswerten Änderungen am Fahrtenbuch. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionierung an
[Semantic Versioning](https://semver.org/lang/de/). Build-Nummern und reine
Release-Commits sind nicht aufgeführt.

## [0.5.2] – 2026-10-17

### Hinzugefügt
- **Geocoding-Einstellungen** als eigener Tab in der Administration: Photon wahlweise öffentlich, als eigener Server oder über Dawarich Atlas; Map-Matching über Valhalla, OSRM oder Atlas – jeweils mit Verbindungstest.
- **Dawarich Atlas** als Dienst (Basis-URL, Timeout, Fähigkeiten) und ein **Systemcheck**, der je Modul anzeigt, ob es erreichbar, falsch konfiguriert oder inaktiv ist; Atlas-Routing im Aufbau wird als „startet“ gemeldet.
- **Map-Matching als Hintergrundaufgabe**, manuell startbar (nur ungematchte, fehlgeschlagene erneut oder alle Fahrten). Die Strecke wird nur übernommen, wenn sie plausibel ist; Rohdaten bleiben unverändert, Fahrten in abgeschlossenen Zeiträumen werden übersprungen.
- Dashboard zeigt bei gematchten Fahrten die **Route auf der Straße** und optional die **Originalroute** aus den GPS-Punkten.
- Liste der abgelehnten oder fehlgeschlagenen Map-Matchings mit Grund in den Hintergrundaufgaben.

### Geändert
- Lange Fahrten werden für das Map-Matching in Abschnitte von höchstens 100 km zerlegt; GPS-Ausreißer werden vorher entfernt. Fehlermeldungen nennen den Abschnitt und den Grund.
- Redis Insight ist in die Hintergrundaufgaben gewandert, mit der Redis-Verbindung vorkonfiguriert und über `REDIS_INSIGHT_URL` verlinkbar.
- **Fahrzeugkosten** sind vorerst eine Vorschau-Funktion und nur im `:dev`-Image aktiv (`FEATURE_EXPENSES` zum Umschalten).
- Ist Geocoding deaktiviert, werden Adressen übersprungen und der Heimatort fällt auf Koordinaten zurück.

### Behoben
- **Fahrten freigegebener Fahrer** fehlten in der Fahrzeugstatistik und landeten als „Nicht erklärt“. Sie zählen jetzt für die Zeit der eigenen Halterschaft mit und erscheinen als eigene Kategorie „Andere Fahrer“ – nur als Summe, ohne Ziele oder Kategorien der anderen.

## [0.5.1] – 2026-10-16

### Geändert
- Beim Start einer Aufzeichnung speichert der Server eine vom Gerät erzeugte Fahrt-ID und das Gerät. Ein erneuter Start derselben Fahrt ist dadurch eindeutig; bei bereits aktiver Aufzeichnung liefert die API genug Details, damit die App ihre eigenen Fahrten aufräumen kann.

## [0.5.0] – 2026-10-16

### Hinzugefügt
- **Fahrzeugkosten**: Tanken und Laden sowie sonstige Kosten mit Jahresübersicht, Kosten pro Kilometer, Anteil je Fahrtart und Verbrauch (Volltank-Methode).
- **CSV-Import** für Kosten mit automatischer Erkennung von Spritmonitor-Exporten; andere CSV-Dateien über Spaltenzuordnung. Doppelte Einträge werden übersprungen.
- Passkeys aus der offiziellen Android-App werden standardmäßig akzeptiert (abschaltbar), weitere Apps optional.

### Behoben
- Geht die Antwort auf einen Aufzeichnungsstart verloren, führt der erneute Start derselben Fahrt nicht mehr dauerhaft zu „Aufzeichnung bereits aktiv“.

## [0.4.1] – 2026-10-14

### Hinzugefügt
- Anmeldung mit verknüpften **Google- und Microsoft-Konten**, auch aus der mobilen App.
- **Gravatar**-Profilbilder, für Benutzer und Instanz abschaltbar.
- Schalter `TOTP_ENABLED` und `PASSKEYS_ENABLED`.
- Passkeys aus der Android-App (Asset Links und APK-Origin).

## [0.4.0] – 2026-10-14

### Geändert
- **Neue Oberfläche** für alle Seiten: Navigation, Dashboard, Fahrzeuge, Statistik, Export, Prüfung, Profil, Administration und Einladungsseite.
- Statistik zeigt die Kilometer pro Monat **gestapelt nach Kategorie**; nicht erfasste Kilometer sind schraffiert, ein Klick öffnet die Monatsdetails.
- Feste Standardfarben je Fahrtkategorie in Karte, Liste und Statistik.
- Profil mit Abschnittsnavigation; die Hell/Dunkel-Einstellung des Kontos wirkt jetzt tatsächlich.

### Hinzugefügt
- **Passwort zurücksetzen** über „Passwort vergessen?“ und die Seite `/password-reset`.
- „Fahrt öffnen“ aus der Prüfung führt direkt zur Fahrt im Dashboard.
- Export mit Schnellauswahl für übliche Zeiträume.

### Behoben
- Dashboard: doppelter Button zum Aufteilen, Bearbeiten-Aktionen im Historie-Tab, Absturz bei Fahrten ohne Fahrzeug oder Tags, veraltetes Token im Karten-Klick, überzeichnete Auswahl bei langsamem Kartenaufbau.
- Einzelne GPS-Ausreißer zoomen die Übersichtskarte nicht mehr auf die ganze Welt.
- Datumswerte in Statistik, Prüfung und Fahrzeugdialogen nutzen den lokalen Tag statt UTC; Fahrtzeiten werden in der Zeitzone der Fahrt angezeigt.
- Login im hellen Modus lesbar; englische Oberfläche ohne deutsche Textreste auf der Einladungsseite.
- CSV/PDF-Download bricht in Firefox und Safari nicht mehr ab.

## [0.3.27] – 2026-10-14
Keine funktionalen Änderungen.

## [0.3.26] – 2026-10-14
Keine funktionalen Änderungen.

## [0.3.25] – 2026-10-14

### Hinzugefügt
- **Sonderkategorien** für Fahrten (z. B. Arztbesuch, Ehrenamt, Umzug) zusätzlich zur Fahrtart – filterbar im Dashboard und enthalten in CSV und PDF.
- Klassifizierung setzt auch Zweck, Ansprechpartner und Notizen.

### Geändert
- Jede Fahrt speichert ihre **Zeitzone**; Statistiken rechnen in der Ortszeit der Fahrt statt in UTC bzw. fest Europe/Berlin (inkl. Sommerzeit).

## [0.3.24] – 2026-10-13

### Hinzugefügt
- Persönliche Einstellungen für **Entfernung (km/mi), Geschwindigkeit (km/h/mph), Datumsformat (EU/US) und Uhrzeitformat (12/24 h)** in einem eigenen Tab.
- Aufteilen von Fahrten mit Auswahl des Trennpunkts in Liste und Karte.

### Geändert
- Dashboard, Fahrzeuge und Profil vollständig auf Deutsch und Englisch übersetzt.
- Mobile Fahrtenliste und aufklappbare Details überarbeitet.

### Behoben
- Abgelaufene Anmeldungen werden automatisch erneuert, statt Anfragen scheitern zu lassen.
- Zusammenführen von Fahrten scheitert nicht mehr an der Reihenfolge der GPS-Punkte.

## [0.3.23] – 2026-10-12
Keine funktionalen Änderungen.

## [0.3.22] – 2026-10-12

### Geändert
- Logo in der Navigation.
- README, Integrationsanleitung und OpenAPI-Spezifikation überarbeitet (Englisch).

### Behoben
- Docker Compose legt die persistenten Volumes selbst an.

## [0.3.21] – 2026-10-12

### Hinzugefügt
- Mobiles Dashboard mit Umschalter zwischen Karte und Fahrten.

### Geändert
- Erreichtes Kilometerlimit wird rot markiert.

## [0.3.20] – 2026-10-12

### Hinzugefügt
- Ablesungen speichern die **tatsächliche Uhrzeit** der Ablesung; das Ableseprotokoll zeigt sie an.

### Behoben
- Leasing-Prognose rechnet ab der letzten Zwischenablesung und berücksichtigt nur Fahrten nach deren Uhrzeit.

## [0.3.19] – 2026-10-11

### Behoben
- Fehlerhafte Imports in den Profileinstellungen nach Einführung der Routenfarben.

## [0.3.18] – 2026-10-11

### Hinzugefügt
- **Routenfarben je Fahrtkategorie** in den persönlichen Einstellungen.
- Optionale Linie für das monatliche Vertragslimit im Statistik-Diagramm; Monatswerte beim Überfahren.

### Behoben
- Eine einzelne Ablesung wird nicht mehr als Anfang und Ende eines Monats gewertet.

## [0.3.17] – 2026-10-11

### Hinzugefügt
- **Kilometerabrechnung** für Leasing und Finanzierung: Freigrenzen sowie Euro je Mehr- und Minderkilometer, Prognose der Nachzahlung oder Erstattung.
- Fahrten nach der letzten Ablesung fließen in die Leasing-Prognose ein.

### Geändert
- Akzentfarbe auf Sky umgestellt.

## [0.3.16] – 2026-10-10

### Behoben
- Reine Kategorieänderungen werden korrekt in der Historie protokolliert, auch für „Nicht zugeordnet“.

## [0.3.15] – 2026-10-09

### Hinzugefügt
- Fahrtenbuch-Logo als Favicon, Touch-Icon und in der Navigation.

## [0.3.14] – 2026-10-09

### Hinzugefügt
- Kategoriebalken der Monatsstatistik sind anklickbar und zeigen die zugehörigen Fahrten; nicht zugeordnete Fahrten lassen sich dort direkt klassifizieren.

## [0.3.13] – 2026-10-08

### Hinzugefügt
- Rückwärtssuche der Adressen (Photon) manuell aus der Administration startbar.

## [0.3.12] – 2026-10-08

### Hinzugefügt
- **Hintergrundaufgaben** mit Redis und eigenem Worker-Container; Übersicht und erneutes Ausführen in der Administration.
- Start- und Zieladressen werden nach der Aufzeichnung über **Photon** ermittelt, auch nachträglich für ältere Fahrten.
- Redis Insight als Weboberfläche für Redis.

## [0.3.11] – 2026-10-08

### Hinzugefügt
- Kartenanzeige einer Fahrt als Strecke, Strecke mit Punkten oder nur GPS-Punkte.

## [0.3.10] – 2026-10-08

### Behoben
- Fahrzeugkarten zeigen den neuesten Kilometerstand.

## [0.3.9] – 2026-10-08

### Behoben
- Fahrzeuge mit Fahrten, aber ohne Ablesung erscheinen in der Statistik; Fahrten werden nach lokalem Kalendermonat gruppiert.

## [0.3.8] – 2026-10-08

### Hinzugefügt
- **Fahrtdetails** mit bearbeitbarer Kategorie und Tags direkt im Dashboard.
- **Archiv** für gelöschte Fahrten mit Wiederherstellen; endgültige Löschung nach 90 Tagen.

### Behoben
- Auf der Karte wird nur noch die ausgewählte Fahrt gezeigt.
- Die Statistik enthält den laufenden Monat.

## [0.3.7] – 2026-10-08

### Behoben
- Datenbankfehler beim Abgleich paralleler Aufzeichnungen; Absturz des Dashboards bei ausgewählter Fahrt.

## [0.3.6] – 2026-10-08

### Behoben
- Nach der Anmeldung geht es zurück zur ursprünglich aufgerufenen Seite, z. B. zur Fahrzeugeinladung.
- Fahrten mit abgemeldeten Fahrzeugen bleiben möglich, die Zugriffsprüfung bleibt bestehen.

## [0.3.5] – 2026-10-06

### Hinzugefügt
- **Fahrzeugarchiv** mit Wiederherstellen.

### Behoben
- Freigabelinks verwenden `PUBLIC_BASE_URL`; abgemeldete Fahrzeuge bleiben für den Besitzer sichtbar.

## [0.3.4] – 2026-10-06

### Hinzugefügt
- Abgemeldete Fahrzeuge lassen sich wieder anmelden.

### Behoben
- Erinnerung an den Kilometerstand nur, wenn der Vormonat fehlt; Jahresstatistik berücksichtigt die Ablesung am Jahreswechsel.

## [0.3.3] – 2026-10-06

### Behoben
- Ablesungen an Monatsgrenzen werden dem richtigen Monat zugeordnet.

## [0.3.2] – 2026-10-06

### Hinzugefügt
- Optionale **Swagger-Oberfläche** für die API.

## [0.3.1] – 2026-10-06

### Behoben
- Übersetzungsfehler in Login, Fahrzeugeditor und Fahrzeugdialogen.

## [0.3.0] – 2026-10-06

### Hinzugefügt
- **Mehrsprachigkeit (Deutsch und Englisch)** mit globaler Standardsprache und persönlicher Auswahl.

## [0.2.9] – 2026-10-06

### Hinzugefügt
- **Fahrzeugfreigabe per E-Mail-Einladung** mit Bestätigung sowie zeitlich begrenzte Freigabelinks.
- Fahrten auf geteilten Fahrzeugen lassen sich einem anderen Fahrer zuweisen oder an den Besitzer zurückgeben.

### Behoben
- Nur der Fahrzeugbesitzer darf Fahrten frei umhängen; abgeglichene Geräteaufzeichnungen zählen nicht doppelt.

## [0.2.8] – 2026-10-06

### Hinzugefügt
- **Leasing und Finanzierung** mit Vertragsdaten und Kilometerprognose.
- **Abmelden und Besitzerwechsel** von Fahrzeugen mit Besitzzeiträumen.
- Abgleich paralleler Aufzeichnungen mehrerer Geräte.

### Behoben
- Bluetooth-Historie bleibt erhalten; Konflikte bei aktiver Aufzeichnung werden verhindert.

## [0.2.7] – 2026-10-06

### Behoben
- Diagramm lädt die Daten für manuell gewählte Zeiträume.

## [0.2.6] – 2026-10-06

### Hinzugefügt
- Konfigurierbares Statistik-Diagramm und Ableseprotokoll als Dialog.

## [0.2.5] – 2026-10-06

### Hinzugefügt
- **Mehrere Ablesungen pro Monat** mit genauem Datum; Genauigkeit nach Ableseintervall.

## [0.2.4] – 2026-10-06

### Hinzugefügt
- Kilometerstände lassen sich nachtragen.

### Behoben
- Abstürze durch ungültige Datumswerte; Docker-Volumes als extern behandelt.

## [0.2.3] – 2026-10-06

### Behoben
- Ungültige Datumswerte im Frontend werden abgefangen.

## [0.2.2] – 2026-10-06

### Hinzugefügt
- **Fahrzeuge mit anderen Benutzern teilen**; der Besitzer sieht deren Nutzung nur datenschutzfreundlich als Anzahl.

## [0.2.1] – 2026-10-05

### Geändert
- Docker-Image wird direkt nach dem Release gebaut.

## [0.2.0] – 2026-10-05

### Hinzugefügt
- **Passkeys** für passwortlose Anmeldung, inkl. Verwaltung und Umbenennen.
- **Prüfung und Abschluss**: manipulationssichere Fahrtenhistorie mit Revisionskette, Plausibilitätsprüfungen und gesperrte Zeiträume; Integritätszertifikat im PDF-Export.
- **Monatliche Kilometerstände** mit Erinnerung und Monatsstatistik inkl. nicht erklärter Kilometer.
- Fahrten **aufteilen und zusammenführen**, **Route korrigieren** und Klassifizierungsvorschläge anhand gespeicherter Orte.
- Arbeitsort und Erkennungsradius.
- Build-Nummer neben der Versionsnummer.

## [0.1.1] – 2026-08-10
Keine funktionalen Änderungen.

## [0.1.0] – 2026-08-10

### Hinzugefügt
- Erste Version: Anmeldung, Dashboard mit Karte (MapLibre mit Protomaps oder OSM-Kachel-Cache), Fahrzeuge, Benutzerverwaltung, vollständige API für die App, Export für mehrere Länder sowie Datenexport und -import.

[0.5.2]: https://github.com/cheinisch/fahrtenbuch/compare/v0.5.1...main
[0.5.1]: https://github.com/cheinisch/fahrtenbuch/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/cheinisch/fahrtenbuch/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/cheinisch/fahrtenbuch/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.27...v0.4.0
[0.3.27]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.26...v0.3.27
[0.3.26]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.25...v0.3.26
[0.3.25]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.24...v0.3.25
[0.3.24]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.23...v0.3.24
[0.3.23]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.22...v0.3.23
[0.3.22]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.21...v0.3.22
[0.3.21]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.20...v0.3.21
[0.3.20]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.19...v0.3.20
[0.3.19]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.18...v0.3.19
[0.3.18]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.17...v0.3.18
[0.3.17]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.16...v0.3.17
[0.3.16]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.15...v0.3.16
[0.3.15]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.14...v0.3.15
[0.3.14]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.13...v0.3.14
[0.3.13]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.12...v0.3.13
[0.3.12]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.11...v0.3.12
[0.3.11]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/cheinisch/fahrtenbuch/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.9...v0.3.0
[0.2.9]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/cheinisch/fahrtenbuch/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/cheinisch/fahrtenbuch/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/cheinisch/fahrtenbuch/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cheinisch/fahrtenbuch/releases/tag/v0.1.0
