# Fahrtenbuch – Integration Guide

This document describes the integration points in the current Fahrtenbuch repository. It is **not** a patch guide: the application and API routes listed here are already wired up.

## Architecture

- **Frontend:** React with React Router, authentication context, and internationalization.
- **Backend:** Node.js / Express REST API under `/api/v1`.
- **Persistence:** PostgreSQL 16, including database migrations and initial administrator seeding.
- **Background processing:** A separate Node.js worker using Redis.
- **Deployment:** Docker Compose with application, worker, PostgreSQL, Redis, and Redis Insight services.

For installation instructions, see [README.md](README.md). For the API contract, see [api/openapi.yml](api/openapi.yml) and [README_API.md](README_API.md).

## Frontend routes

The frontend routes are defined in [frontend/src/App.jsx](frontend/src/App.jsx).

| Route | Purpose | Access |
| --- | --- | --- |
| `/login` | Sign in | Public |
| `/` | Dashboard | Authenticated |
| `/vehicles` | Vehicle management | Authenticated |
| `/share-invitation` | Vehicle sharing invitation | Authenticated |
| `/statistics` | Mileage statistics | Authenticated |
| `/export` | Data export | Authenticated |
| `/compliance` | Compliance features | Authenticated |
| `/profilesettings` | Personal profile and preferences | Authenticated |
| `/settings` | Administration and global settings | Administrator |

`ProtectedRoute` guards authenticated pages, and `AdminRoute` additionally restricts the administration page. The application shell provides the shared navigation and layout.

The entry point in [frontend/src/main.jsx](frontend/src/main.jsx) wraps the application with `BrowserRouter`, `AuthProvider`, and `I18nProvider`. Do not add another router or duplicate these providers when extending the frontend.

## Backend route registration

All Express routes are already mounted in [backend/src/app.js](backend/src/app.js). The entry point [backend/src/server.js](backend/src/server.js) runs database migrations, seeds the default administrator, and starts the HTTP server.

| Base path | Function |
| --- | --- |
| `/api/v1/health` | Health check |
| `/api/v1/language` | Default and supported UI languages |
| `/api/v1/auth` | Authentication, sessions, MFA, passkeys, and pairing |
| `/api/v1/users` | User profile, settings, and devices |
| `/api/v1/vehicles` | Vehicles and sharing |
| `/api/v1/odometer` | Odometer readings |
| `/api/v1/places` | Places and location preferences |
| `/api/v1/trips` | Trip management |
| `/api/v1/tracking` | GPS tracking |
| `/api/v1/tags` | Trip tags |
| `/api/v1/dashboard` | Dashboard data |
| `/api/v1/statistics` | Statistics |
| `/api/v1/compliance` | Compliance operations |
| `/api/v1/map` | Map resources and tile handling |
| `/api/v1/config` | Service configuration |
| `/api/v1/geocoding` | Geocoding |
| `/api/v1/settings` | Application settings |
| `/api/v1/import` | Import operations |
| `/api/v1/export` | Export operations |
| `/api/v1/admin` | Administration |
| `/api/v1/admin/data` | Administrative data operations |

When adding a new API module, register it in `backend/src/app.js`, apply appropriate server-side authorization, and update the OpenAPI specification. Do not follow the former instructions to add imports or `app.use()` calls to `server.js`.

### API documentation

The OpenAPI source is [api/openapi.yml](api/openapi.yml). Set `SHOW_API_UI=true` to enable Swagger UI at `/api` and `/api/docs` and the specification endpoint at `/api/v1/openapi.yml`. These routes are disabled by default.

## Environment configuration

Use the single root-level [`.env.example`](.env.example) as the template:

```bash
cp .env.example .env
```

The former `.env.api.example` has been removed. The Compose services use the root `.env` file. Configure at least:

- `POSTGRES_PASSWORD`: PostgreSQL password.
- `JWT_SECRET`: strong access-token signing secret.
- `TOTP_ENCRYPTION_KEY`: separate encryption secret.
- `DEFAULT_ADMIN_USERNAME`, `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD`: initial administrator credentials.
- `PUBLIC_BASE_URL`, `CORS_ORIGIN`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`: public HTTPS host and origin.

The backend accepts some legacy aliases (for example, `JWT_ACCESS_SECRET` and `RP_ID`), but new installations should use the canonical names in `.env.example`. Several optional values have defaults in [backend/src/config.js](backend/src/config.js); image version/build metadata is supplied by the image rather than manually configured. The import/upload limit is fixed at 200 MiB in the backend configuration.

Map, Photon, and Overpass service defaults are defined in the backend configuration. Optional password-reset webhook and SMTP settings are documented in `.env.example`.

## Docker Compose integration

[docker-compose.yml](docker-compose.yml) defines these services:

| Service | Role |
| --- | --- |
| `app` | Web frontend and REST API, container port 3000 |
| `worker` | Background jobs |
| `db` | PostgreSQL 16 |
| `redis` | Redis 7 for background processing |
| `redis-insight` | Optional operational interface, bound to localhost by default |

The Compose file manages named volumes for database data, Redis, OSM tile cache, and backups. Do not remove volumes when updating an existing installation.

```bash
docker compose up -d
docker compose ps
```

The application host binding is controlled by `APP_BIND_IP` and `APP_PORT`; the default host port is 3000. Redis Insight defaults to host `127.0.0.1:5540`. Use HTTPS through a reverse proxy for externally accessible installations.

## Authentication and permissions

The frontend uses the authentication provider for sessions and protected navigation. API authorization must still be enforced **server-side**; frontend route guards are not a security boundary. Vehicle sharing and user-specific data must respect ownership and granted access. Use the documented API endpoints for login, token refresh, pairing, device management, and other account operations.

## UI styling and languages

Frontend styling is defined in [frontend/src/index.css](frontend/src/index.css). The existing theme uses the following `fb-` color tokens:

- `fb-main`, `fb-surface`, `fb-text`, `fb-muted`, `fb-border`
- `fb-accent`, `fb-accent-secondary`, `fb-accent-text`, `fb-accent-soft`
- `fb-danger`

Reuse the established theme and component conventions instead of introducing a parallel color system. Internationalization is provided through `I18nProvider`; keep new user-facing text in the project's translation resources rather than hard-coding it.

## Development and validation

Node.js 22 or newer is required for local development.

```bash
npm ci
npm run dev
npm run build
npm run lint
npm test
```

Local development requires a reachable PostgreSQL instance and appropriate backend environment variables. The production frontend is built and served by the application image. When modifying integrations, verify the relevant API behavior, authorization rules, and frontend build before deployment.
