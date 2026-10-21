# Changelog

All notable changes to Fahrtenbuch. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/). Build numbers and release-only
commits are not listed.

## [Unreleased]

### Added
- **Remove single GPS points** in the web dashboard (trip details › Edit › Remove single points): click points on the map to mark them, or let the dashboard mark likely outliers (jumps that would need an implausible detour or speed, or points the device reported as very inaccurate). The map previews the route without the marked points together with the new distance. Distance, duration and start/end coordinates are recalculated, an existing map matching is discarded, and the removed points are kept with coordinates and time in the trip history (`POINTS_REMOVED`). `POST /trips/{id}/points/remove`.
- **Monthly report by e-mail** on the first of each month (06:00 local time, caught up until the 7th): all own and shared vehicles in one mail (shared ones with your own trips only), open trips waiting for a category, and places visited for the first time that month. Requires SMTP; each user can turn it off under Profile › Notifications. Each report is sent once per user and month.
- **Monthly report page** in the web app (Statistics › Monthly report) with the same content: assign open trips and save new places directly, and switch the e-mail on or off. `GET /reports/monthly`.
- "Send monthly report now" for testing, in the `:dev` image only (`FEATURE_MONTHLY_REPORT_SEND_NOW`, `POST /reports/monthly/send`).
- **Setup assistant** on the first admin sign-in of a fresh installation: language, own admin password, server status (public address, passkeys, time zone), e-mail, geocoding, sign-in & privacy, first vehicle and pairing the Android app.
- **First sign-in assistant** for accounts created by an administrator: own password, profile, linking Google/Microsoft (only enabled providers), shared and own vehicles, pairing the app. If only a password change is required, just that step is shown.
- **E-mail tab** in the administration: shows the SMTP configuration detected from `SMTP_*` and sends a test e-mail. New optional `SMTP_FROM_NAME`.
- **Employer mileage reimbursement**: vehicles get a default rate (€/km, `businessReimbursementRateEur`). When a trip becomes a business trip and has no rate yet, the vehicle default is copied into the trip (`reimbursementRateEur`); it can be adjusted per trip and is kept when the type changes later. Existing trips are not filled in. Trips return `reimbursementEur` (business trips only); statistics show the reimbursement per month and year (`GET /statistics`, `/statistics/monthly-odometer`, `/statistics/monthly-trips`).

### Fixed
- Manual route correction (`POST /trips/{id}/route-correction`) failed when writing the trip history: two migrations had dropped `ROUTE_CORRECTED` and `AUTO_CLASSIFIED` from the allowed history event types.
- Changing a trip in a closed period now answers 409 `TRIP_PERIOD_LOCKED` with a clear message instead of a 500 error.
- Creating a trip (`POST /trips`) and the full update (`PUT /trips/{id}`) failed with a database type error for the trip status.
- `api/openapi.yml` is a single valid document again: a truncated entry had split it so that about 50 paths sat inside `components` and a second `components` block followed. It now passes a strict YAML parser and redocly lint.

### Changed
- **Gravatar** is switched in the administration now; `GRAVATAR_ENABLED` remains the default until it has been saved there. SMTP stays in `.env`.
- `GET /config/services` additionally returns `setup`, `mail` and `gravatar`; the user object has `onboardingCompleted`.

## [0.5.2] – 2026-10-17

### Added
- **Geocoding settings** as a separate tab in the administration: Photon via the public server, your own server or Dawarich Atlas; map matching via Valhalla, OSRM or Atlas – each with a connection test.
- **Dawarich Atlas** as a service (base URL, timeout, capabilities) and a **system check** that shows per module whether it is available, misconfigured or inactive; Atlas routing that is still building is reported as "starting".
- **Map matching as a background job** that can be started manually (only unmatched trips, retry failed ones, or all trips). The route is only applied when it is plausible; raw data stays unchanged, and trips in closed periods are skipped.
- The dashboard shows the **road route** for matched trips and, optionally, the **original route** from the GPS points.
- List of rejected or failed map matches, with the reason, in the background jobs.

### Changed
- Long trips are split into sections of at most 100 km for map matching; GPS outliers are removed beforehand. Error messages name the section and the reason.
- Redis Insight moved into the background jobs, comes with the Redis connection preconfigured and can be linked via `REDIS_INSIGHT_URL`.
- **Vehicle expenses** are a preview feature for now and only enabled in the `:dev` image (toggle with `FEATURE_EXPENSES`).
- When geocoding is disabled, addresses are skipped and the home location falls back to coordinates.

### Fixed
- **Trips by drivers a vehicle is shared with** were missing from the vehicle statistics and counted as "unexplained". They now count for the period in which you owned the vehicle and appear as a separate "other drivers" category – as a total only, without the other drivers' destinations or categories.

## [0.5.1] – 2026-10-16

### Changed
- When a recording starts, the server stores a trip ID generated by the device, along with the device. A repeated start of the same trip is therefore unambiguous; if a recording is already active, the API returns enough details for the app to clean up its own trips.

## [0.5.0] – 2026-10-16

### Added
- **Vehicle expenses**: fuel and charging as well as other costs, with a yearly summary, cost per kilometre, share per trip type and consumption (full-tank method).
- **CSV import** for expenses with automatic detection of Spritmonitor exports; other CSV files via column mapping. Duplicate entries are skipped.
- Passkeys from the official Android app are accepted by default (can be turned off); further apps are optional.

### Fixed
- If the response to a recording start gets lost, starting the same trip again no longer results in "recording already active" indefinitely.

## [0.4.1] – 2026-10-14

### Added
- Sign-in with linked **Google and Microsoft accounts**, including from the mobile app.
- **Gravatar** profile pictures, can be turned off per user and per instance.
- `TOTP_ENABLED` and `PASSKEYS_ENABLED` switches.
- Passkeys from the Android app (asset links and APK origin).

## [0.4.0] – 2026-10-14

### Added
- **Password reset** via "Forgot password?" and the `/password-reset` page.
- "Open trip" in the compliance page leads directly to the trip on the dashboard.
- Export with quick selection of common periods.

### Changed
- **New interface** for all pages: navigation, dashboard, vehicles, statistics, export, compliance, profile, administration and invitation page.
- Statistics show the kilometres per month **stacked by category**; unrecorded kilometres are hatched, and a click opens the month details.
- Fixed default colours per trip category on the map, in the list and in the statistics.
- Profile with section navigation; the account's light/dark setting now actually takes effect.

### Fixed
- Dashboard: duplicate split button, edit actions shown in the history tab, crash for trips without a vehicle or tags, stale token in the map click handler, selection overdrawn when the map loads slowly.
- Single GPS outliers no longer zoom the overview map out to the whole world.
- Dates in statistics, compliance and vehicle dialogs use the local day instead of UTC; trip times are shown in the trip's time zone.
- Login readable in light mode; English interface without leftover German text on the invitation page.
- CSV/PDF downloads no longer abort in Firefox and Safari.

## [0.3.27] – 2026-10-14
No functional changes.

## [0.3.26] – 2026-10-14
No functional changes.

## [0.3.25] – 2026-10-14

### Added
- **Special categories** for trips (e.g. medical appointment, volunteering, moving) in addition to the trip type – filterable on the dashboard and included in CSV and PDF.
- Classification also sets purpose, contact and notes.

### Changed
- Each trip stores its **time zone**; statistics are calculated in the trip's local time instead of UTC or a fixed Europe/Berlin (including daylight saving time).

## [0.3.24] – 2026-10-13

### Added
- Personal settings for **distance (km/mi), speed (km/h/mph), date format (EU/US) and time format (12/24 h)** in a separate tab.
- Splitting trips with selection of the split point in the list and on the map.

### Changed
- Dashboard, vehicles and profile fully translated into German and English.
- Mobile trip list and expandable details reworked.

### Fixed
- Expired sessions are renewed automatically instead of letting requests fail.
- Merging trips no longer fails because of the order of the GPS points.

## [0.3.23] – 2026-10-12
No functional changes.

## [0.3.22] – 2026-10-12

### Changed
- Logo in the navigation.
- README, integration guide and OpenAPI specification reworked (in English).

### Fixed
- Docker Compose creates the persistent volumes itself.

## [0.3.21] – 2026-10-12

### Added
- Mobile dashboard with a switch between map and trips.

### Changed
- A reached mileage limit is highlighted in red.

## [0.3.20] – 2026-10-12

### Added
- Odometer readings store the **actual time** of the reading; the reading log shows it.

### Fixed
- The leasing forecast calculates from the latest intermediate reading and only takes trips after its time into account.

## [0.3.19] – 2026-10-11

### Fixed
- Broken imports in the profile settings after the route colours were introduced.

## [0.3.18] – 2026-10-11

### Added
- **Route colours per trip category** in the personal settings.
- Optional line for the monthly contract limit in the statistics chart; monthly values on hover.

### Fixed
- A single reading is no longer treated as both the start and the end of a month.

## [0.3.17] – 2026-10-11

### Added
- **Mileage settlement** for leasing and financing: tolerances and euros per excess and shortfall kilometre, with a forecast of the additional payment or refund.
- Trips after the latest reading are included in the leasing forecast.

### Changed
- Accent colour switched to sky blue.

## [0.3.16] – 2026-10-10

### Fixed
- Category-only changes are recorded correctly in the history, including "unclassified".

## [0.3.15] – 2026-10-09

### Added
- Fahrtenbuch logo as favicon, touch icon and in the navigation.

## [0.3.14] – 2026-10-09

### Added
- The category bars of the monthly statistics are clickable and list the corresponding trips; unclassified trips can be classified there directly.

## [0.3.13] – 2026-10-08

### Added
- Reverse address lookup (Photon) can be started manually from the administration.

## [0.3.12] – 2026-10-08

### Added
- **Background jobs** with Redis and a dedicated worker container; overview and retry in the administration.
- Start and destination addresses are determined via **Photon** after a recording, also retroactively for older trips.
- Redis Insight as a web interface for Redis.

## [0.3.11] – 2026-10-08

### Added
- Map display of a trip as route, route with points, or GPS points only.

## [0.3.10] – 2026-10-08

### Fixed
- Vehicle cards show the latest odometer reading.

## [0.3.9] – 2026-10-08

### Fixed
- Vehicles with trips but without readings appear in the statistics; trips are grouped by local calendar month.

## [0.3.8] – 2026-10-08

### Added
- **Trip details** with editable category and tags directly on the dashboard.
- **Archive** for deleted trips with restore; permanent deletion after 90 days.

### Fixed
- Only the selected trip is shown on the map.
- The statistics include the current month.

## [0.3.7] – 2026-10-08

### Fixed
- Database error when reconciling concurrent recordings; dashboard crash with a selected trip.

## [0.3.6] – 2026-10-08

### Fixed
- After signing in, you are taken back to the page you originally opened, e.g. the vehicle invitation.
- Trips with deregistered vehicles remain possible; the access check still applies.

## [0.3.5] – 2026-10-06

### Added
- **Vehicle archive** with restore.

### Fixed
- Share links use `PUBLIC_BASE_URL`; deregistered vehicles remain visible to their owner.

## [0.3.4] – 2026-10-06

### Added
- Deregistered vehicles can be registered again.

### Fixed
- The odometer reminder only appears when the previous month is missing; annual statistics include the reading at the turn of the year.

## [0.3.3] – 2026-10-06

### Fixed
- Readings at month boundaries are assigned to the correct month.

## [0.3.2] – 2026-10-06

### Added
- Optional **Swagger UI** for the API.

## [0.3.1] – 2026-10-06

### Fixed
- Translation errors on the login page, in the vehicle editor and in vehicle dialogs.

## [0.3.0] – 2026-10-06

### Added
- **Multilingual interface (German and English)** with a global default language and a personal choice.

## [0.2.9] – 2026-10-06

### Added
- **Vehicle sharing by email invitation** with confirmation, as well as time-limited share links.
- Trips on shared vehicles can be assigned to another driver or returned to the owner.

### Fixed
- Only the vehicle owner may freely reassign trips; reconciled device recordings are no longer counted twice.

## [0.2.8] – 2026-10-06

### Added
- **Leasing and financing** with contract data and mileage forecast.
- **Deregistering vehicles and transferring ownership**, with ownership periods.
- Reconciliation of concurrent recordings from several devices.

### Fixed
- Bluetooth history is preserved; conflicts during an active recording are prevented.

## [0.2.7] – 2026-10-06

### Fixed
- The chart loads the data for manually selected periods.

## [0.2.6] – 2026-10-06

### Added
- Configurable statistics chart and the reading log as a dialog.

## [0.2.5] – 2026-10-06

### Added
- **Multiple readings per month** with an exact date; accuracy per reading interval.

## [0.2.4] – 2026-10-06

### Added
- Odometer readings can be entered retroactively.

### Fixed
- Crashes caused by invalid date values; Docker volumes treated as external.

## [0.2.3] – 2026-10-06

### Fixed
- Invalid date values in the frontend are caught.

## [0.2.2] – 2026-10-06

### Added
- **Sharing vehicles with other users**; the owner sees their usage only as a privacy-friendly count.

## [0.2.1] – 2026-10-05

### Changed
- The Docker image is built directly after the release.

## [0.2.0] – 2026-10-05

### Added
- **Passkeys** for passwordless sign-in, including management and renaming.
- **Compliance and period closing**: tamper-evident trip history with a revision chain, plausibility checks and locked periods; integrity certificate in the PDF export.
- **Monthly odometer readings** with a reminder and monthly statistics including unexplained kilometres.
- **Splitting and merging** trips, **route correction** and classification suggestions based on saved places.
- Work location and recognition radius.
- Build number shown alongside the version number.

## [0.1.1] – 2026-08-10
No functional changes.

## [0.1.0] – 2026-08-10

### Added
- First version: sign-in, dashboard with map (MapLibre with Protomaps or an OSM tile cache), vehicles, user administration, full API for the app, export for several countries, and data export and import.

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
