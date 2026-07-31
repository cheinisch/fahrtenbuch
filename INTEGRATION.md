# Fahrtenbuch – Dashboard und Einstellungen

## Enthaltene Frontend-Routen

- `/` – Dashboard
- `/profilesettings` – persönliche Einstellungen
- `/settings` – Administration, nur für Administratoren

## Backend-Routen

- `GET /api/v1/dashboard`
- `GET /api/v1/users/me/settings`
- `PATCH /api/v1/users/me/profile`
- `PATCH /api/v1/users/me/settings`
- `POST /api/v1/users/me/password`
- `GET /api/v1/users/me/devices`
- `DELETE /api/v1/users/me/devices/:deviceId`
- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/users`
- `PATCH /api/v1/admin/users/:userId`
- `GET /api/v1/admin/settings`
- `PATCH /api/v1/admin/settings`

## server.js ergänzen

```js
import { adminRoutes } from "./routes/adminRoutes.js";
import { dashboardRoutes } from "./routes/dashboardRoutes.js";
```

Nach den Auth-Routen einbinden:

```js
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/admin", adminRoutes);
```

Die bereits vorhandene Zeile bleibt:

```js
app.use("/api/v1/users", userRoutes);
```

## Theme

Die Seiten erwarten weiterhin diese Tailwind-Farben:

- `fb-main`
- `fb-surface`
- `fb-text`
- `fb-muted`
- `fb-border`
- `fb-accent`
- `fb-accent-secondary`
- `fb-accent-text`
- `fb-accent-soft`
- `fb-danger`
