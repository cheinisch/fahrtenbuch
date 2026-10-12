# Fahrtenbuch REST API

The Fahrtenbuch API provides access to authentication, users, vehicles, trips, GPS tracking, odometer readings, statistics, map services, imports, exports, and administration.

**OpenAPI specification:** [api/openapi.yml](api/openapi.yml)

## Base URL and authentication

The default API base path is:

```text
https://your-domain.example/api/v1
```

Protected endpoints use an access token:

```http
Authorization: Bearer <accessToken>
```

Authenticate with `POST /api/v1/auth/login` and renew access using `POST /api/v1/auth/refresh`. Store refresh tokens securely and replace them after rotation.

Example login request:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "identifier": "admin@example.com",
  "password": "your-password",
  "deviceName": "Android",
  "platform": "android",
  "appVersion": "1.0.0"
}
```

## API areas

| Area | Description |
| --- | --- |
| System | Health and system information |
| Auth / MFA / Passkeys | Login, refresh tokens, password reset, TOTP, and WebAuthn |
| App Pairing / Devices | QR-based device pairing and registered device management |
| Users | User profiles and administrative user management |
| Vehicles | Vehicle records, ownership, sharing, and Bluetooth assignments |
| Trips / Tracking | Trip records, classification, GPS points, and tracking sessions |
| Tags | Trip tags and categorization |
| Dashboard / Statistics | Trip summaries, odometer readings, and mileage statistics |
| Geocoding / Services | Map configuration, Photon geocoding, and Overpass searches |
| Settings | Personal and service settings |
| Import / Export | CSV, GPX, and PDF workflows |
| Admin | Administration and backup operations |

For exact endpoints, parameters, response schemas, and authorization requirements, refer to the [OpenAPI specification](api/openapi.yml).

## API documentation in a running installation

Swagger UI is optional and disabled by default. To enable it, set:

```dotenv
SHOW_API_UI=true
```

When enabled, the documentation is available at:

- `/api`
- `/api/docs`
- `/api/v1/openapi.yml`

Only expose API documentation where appropriate for your deployment.

## Configuration

Use the repository's [`.env.example`](.env.example) as the reference for supported environment variables. Important settings include:

```dotenv
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=fahrtenbuch
POSTGRES_USER=fahrtenbuch
POSTGRES_PASSWORD=CHANGE_ME

JWT_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_SECRET
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d

PUBLIC_BASE_URL=https://your-domain.example
TOTP_ENCRYPTION_KEY=CHANGE_ME_TO_A_SEPARATE_SECRET
WEBAUTHN_RP_ID=your-domain.example
WEBAUTHN_ORIGIN=https://your-domain.example

MIGRATIONS_DIR=/app/backend/src/database/migrations
BACKUP_DIR=/data/backups
```

Use strong, independent secrets. WebAuthn/passkeys require an appropriate HTTPS origin in production.

## Development and validation

Install workspace dependencies:

```bash
npm ci
```

Check the API specification and its coverage using the repository scripts:

```bash
node backend/scripts/check-api-files.js
node backend/scripts/check-openapi-coverage.js
```

Database migrations are located in `backend/src/database/migrations/`. Back up your database before deploying schema changes.

## Additional references

- [Main README](README.md)
- [API coverage](API_COVERAGE.md)
- [Integration notes](INTEGRATION.md)
- [OpenAPI specification](api/openapi.yml)

## License

AGPL-3.0-only.
