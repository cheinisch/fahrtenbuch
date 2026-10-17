# AGENTS.md

Guidance for AI coding agents (and humans) working on this repository. See `README.md` for the product overview and deployment, `README_API.md` / `INTEGRATION.md` for API usage.

## Project

Self-hosted mileage logbook (Fahrtenbuch). npm workspaces monorepo, Node.js ≥ 22, license AGPL-3.0-only.

- `backend/` – Express 5 REST API (`/api/v1`), PostgreSQL via `pg`, a small Redis job queue (`jobs/`), pdfkit for PDF exports
- `frontend/` – React + Vite web dashboard (translations in `src/i18n/locales/`, see *Translations*)
- `shared/` – shared package
- `api/openapi.yml` – **the public API contract**; mobile clients (e.g. the Android app `cheinisch/fahrtenbuch-android`) are built against it

## Commands

```bash
npm install                        # root, installs all workspaces
npm run dev                        # backend + frontend
npm run migrate --workspace backend
npm run check --workspace backend  # API file check + OpenAPI coverage
npm test                           # node --test in the workspaces
npm run build                      # frontend build
```

`npm run check` currently reports two endpoints missing from the OpenAPI spec (`GET /language`, `GET /odometer/{vehicleId}/{month}`); this is pre-existing. Do not add new gaps.

The backend needs `POSTGRES_*` and `JWT_SECRET`/`JWT_ACCESS_SECRET`; `DEFAULT_ADMIN_EMAIL`/`_USERNAME`/`_PASSWORD` seed an admin. Migrations run automatically on server start. For quick SQL verification a throwaway local PostgreSQL is enough.

## Structure (backend/src)

- `routes/` – one router per area (`tripRoutes`, `trackingRoutes`, `statisticsRoutes`, `dashboardRoutes`, `importExportRoutes`, `odometerRoutes`, …), wrapped in `asyncHandler`, auth via `requireAuth`
- `services/` – shared queries (`tripService.js`: `TRIP_SELECT`, `TRIP_WITH_TAGS_SELECT`), data transfer
- `lib/` – `mappers.js` (DB row → API JSON, camelCase), `validation.js`, `errors.js` (`badRequest`, `notFound`, …), `timezone.js`
- `database/migrations/` – plain SQL, applied in file-name order, never edited after release
- `openapi.yml` – must stay **byte-identical** to `api/openapi.yml`

## Conventions

- **API changes:** update `api/openapi.yml` and copy it to `backend/openapi.yml`. Prefer additive, backwards-compatible changes – existing app versions must keep working.
- **Migrations:** new file `NNNN_description.sql` with the next number; idempotent (`IF NOT EXISTS`, drop/re-add constraints). Never modify an existing migration.
- **Time and time zones:**
  - Store timestamps as `timestamptz` (UTC); dates without time (`reading_date`) are calendar days in the user's zone.
  - Zones are IANA ids (`Europe/Berlin`), never fixed offsets, so DST is handled per timestamp.
  - A trip's local zone is `start_timezone` (recorded by the client), falling back to the account `users.timezone`. Validate input with `timeZoneField` / `isValidTimeZone` from `lib/timezone.js`.
  - Any day/month grouping, date filter or "this month" bound must use the local time, not UTC: `userTimeZone(pool, userId)` plus `tripLocalStartSql("t", "$n")` (e.g. `date_trunc('month', ${tripLocalStartSql("t", "$2")})`, `…::date >= $3::date`). For "now" use `now() AT TIME ZONE $n::text`.
  - **Never hardcode `'Europe/Berlin'`** in queries; it is only the fallback `DEFAULT_TIMEZONE`.
  - In JS use `formatInTimeZone` / `localIsoInTimeZone` instead of `toLocaleString` without a zone.
- **Units:** distances are stored in meters (`distance_meters`), durations in seconds; the API additionally returns km.
- **Errors:** throw `badRequest("CODE", "message")` etc.; user-facing messages are German.
- **Trip categories:** `type` is `business|private|commute|unclassified`; `special_category` is a second level (see `SPECIAL_CATEGORIES`). Category-only changes go through `PUT /trips/{id}/classify`.
- **Frontend texts:** add keys to every language file – see *Translations* below.
- **Preview features:** new features can be limited to the `:dev` image via `config.features` (default on when `APP_CHANNEL=dev`, override with `FEATURE_<NAME>`). The API returns 404 `FEATURE_DISABLED`; clients read `features` from `GET /config/services` (web: `useFeatures()`). Currently: `expenses`.
- Comments are mostly German; either language is fine – keep them short and explain *why*.

## Translations

Default format for all translations: **one JSON file per language** with nested key-value pairs.

```
frontend/src/i18n/locales/
├── de/translation.json
└── en/translation.json
```

```json
{
  "welcome": "Willkommen in unserer Anwendung",
  "buttons": {
    "save": "Speichern",
    "cancel": "Abbrechen"
  }
}
```

- JSON (no JS), UTF-8, 2-space indentation. Comments are allowed (`//` and `/* */`, JSONC) – use them sparingly, e.g. to give translators context.
- Because of the comments, the files must not be loaded with a plain `JSON.parse` / Vite's built-in JSON import; load them through a JSONC-capable parser (e.g. `jsonc-parser` or `json5`).
- Keys in camelCase, grouped by area/component as nested objects; accessed with dot notation (`t("buttons.save")`).
- Every language file has the **same key structure**. German (`de`) is the reference and fallback language – add new keys there first, then to all other languages in the same commit.
- Values are plain strings; placeholders use single braces: `"Fahrzeug {vehicle} gespeichert"` → `t("key", { vehicle })`.
- Reuse generic keys (e.g. `buttons.*`) instead of duplicating identical texts.
- New languages: add `<code>/translation.json` and register it in `I18nProvider.jsx`.
- Files are split into **sections per page/area**, each introduced by a comment `// ===== <Page> =====` (German titles in `de`, English in `en`, same order in every language). Put new keys into the matching section; a new page gets a new section.

## Git

- Default branch: `main`. Small, focused commits, imperative English message.
- CI (`increment-build.yml`) bumps the build number on every push (`chore: bump build N`) – pull/rebase before pushing.
- `VERSION` and `BUILD` are maintained by the release/build workflows; don't edit them by hand.
- Never commit `node_modules/`, `.env` files or secrets.
