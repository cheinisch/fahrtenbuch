# Fahrtenbuch

A self-hosted vehicle trip log with a web dashboard, GPS trip tracking, odometer readings, vehicle management, and mileage statistics.

The application combines a **React** frontend, a **Node.js** backend, **PostgreSQL**, and background processing with **Redis**. It can be deployed with Docker Compose.

## Features

- **Trip management:** Review recorded trips, inspect routes on a map, assign categories, filter trips, and edit trip details.
- **GPS routes:** Display recorded routes using OpenStreetMap-based maps, with optional Protomaps support.
- **Odometer readings:** Record mileage readings with dates and optional exact reading times; review the reading history.
- **Mileage statistics:** Compare odometer changes with recorded trips and examine monthly mileage trends.
- **Leasing and financing:** Track contractual mileage allowances, estimate end-of-contract mileage, and optionally calculate excess-mileage charges or under-mileage reimbursements.
- **Multiple vehicles and users:** Manage vehicles, access permissions, and user-specific settings.
- **Personal map colors:** Configure optional route colors for private, business, commuting, and unclassified trips.
- **Responsive dashboard:** Switch between the map and trip list on smaller screens.
- **Data protection and history:** Support trip audit history and controlled vehicle sharing.
- **Authentication:** Account-based access with passwords, TOTP two-factor authentication, passkeys, and optional sign-in with a linked Google or Microsoft account.

Some capabilities depend on the configured deployment and connected clients.

## Requirements

- Docker and Docker Compose for the recommended deployment
- An accessible hostname and HTTPS reverse proxy for internet-facing installations
- **Node.js 22 or newer** for local development

## Quick start with Docker Compose

Clone the repository and create your configuration file:

```bash
git clone https://github.com/cheinisch/fahrtenbuch.git
cd fahrtenbuch
cp .env.example .env
```

Edit `.env` before starting the application. At minimum, configure:

- `POSTGRES_PASSWORD` — a strong database password
- `JWT_SECRET` — a long, randomly generated signing secret
- `TOTP_ENCRYPTION_KEY` — a separate strong encryption secret
- `DEFAULT_ADMIN_USERNAME`, `DEFAULT_ADMIN_EMAIL`, and `DEFAULT_ADMIN_PASSWORD` — initial administrator credentials
- `PUBLIC_BASE_URL`, `CORS_ORIGIN`, `WEBAUTHN_RP_ID`, and `WEBAUTHN_ORIGIN` — values matching your public hostname and HTTPS origin
- `IMAGE_TAG` — the container image tag to deploy (defaults to `latest` in the Compose file)

Docker Compose automatically creates the required named volumes on first startup, including the PostgreSQL data, OSM tile cache, and backups volumes. Existing volumes with the same names are reused, so no manual `docker volume create` commands are necessary.

> **Data safety:** `docker compose down` keeps the volumes, but `docker compose down -v` removes Compose-managed volumes and can permanently delete database and backup data. Back up your data before removing volumes.

Start the services:

```bash
docker compose up -d
docker compose ps
```

The application listens on port **3000** by default. Open `http://localhost:3000` for local access, or use your configured HTTPS hostname when deployed behind a reverse proxy.

> **Security:** Change all example secrets and administrator credentials before exposing the service to the internet. Use HTTPS and restrict access to administrative services such as Redis Insight.

### Optional: disable TOTP or passkeys

Set `TOTP_ENABLED=false` and/or `PASSKEYS_ENABLED=false` in `.env` to switch these methods off for the whole instance. They can then neither be set up nor used; the login page hides the passkey button. With TOTP disabled, users who had set it up sign in without a code, so only do this deliberately. Stored secrets and passkeys are kept and work again after re-enabling.

### Optional: sign-in with Google or Microsoft

Users can link a Google and/or Microsoft account in their profile settings (*Security → Linked accounts*) and then use it to sign in. Only existing users can link an account — nobody can create an account this way. If two-factor authentication is enabled for a user, the TOTP code is still required.

A provider is enabled as soon as its client ID and secret are set in `.env`. Register an OAuth/OpenID Connect web application with each provider and use this redirect URI:

```
<PUBLIC_BASE_URL>/api/v1/auth/oauth/google/callback
<PUBLIC_BASE_URL>/api/v1/auth/oauth/microsoft/callback
```

- **Google:** Google Cloud Console → *APIs & Services → Credentials → Create OAuth client ID* (type *Web application*). Scopes: `openid`, `email`, `profile`. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
- **Microsoft:** Microsoft Entra admin center → *App registrations → New registration*, platform *Web*, then create a client secret under *Certificates & secrets*. Set `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` and, optionally, `MICROSOFT_OAUTH_TENANT` (`common` = work and personal accounts, `organizations`, `consumers`, or a tenant ID to allow only your organization).

The Android app can use the same providers: after entering the server address it starts the sign-in in a browser tab and the server redirects back to the app (`fahrtenbuch://oauth/callback`; configurable via `OAUTH_APP_REDIRECT_URIS`). No extra setup at Google or Microsoft is needed for this.

Restart the containers after changing these values.

## Updating

Pull the selected image tag and recreate the services:

```bash
docker compose pull
docker compose up -d
```

Keep the database and backup volumes intact. Back up your data before upgrading, especially when database migrations are involved.

## Local development

Install dependencies and run the backend and frontend development servers:

```bash
npm ci
npm run dev
```

A configured PostgreSQL instance and the environment variables required by the backend are still needed. For a production frontend build:

```bash
npm run build
```

Other available scripts include `npm run lint` and `npm test`.

## Repository structure

| Path | Purpose |
| --- | --- |
| `frontend/` | React user interface |
| `backend/` | API, business logic, database migrations, and background jobs |
| `shared/` | Shared workspace code |
| `api/openapi.yml` | API specification |
| `docker-compose.yml` | Docker Compose deployment |
| `.env.example` | Example environment configuration |
| `PROTOMAPS.md` | Protomaps setup information |
| `README_API.md` | Additional API documentation |
| `INTEGRATION.md` | Integration notes |

## API documentation

The complete [OpenAPI specification (YAML)](api/openapi.yml) documents the API endpoints, request and response schemas, and authentication requirements. For a guided introduction, see the [English API documentation](README_API.md). The optional Swagger interface can be enabled with `SHOW_API_UI=true`; when enabled, it is available at `/api` and `/api/docs`.

## License

This project is licensed under **AGPL-3.0-only**, as declared in `package.json`.
