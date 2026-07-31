import {
  useEffect,
  useState,
} from "react";

import {
  getAdminOverview,
  getAdminSettings,
  getAdminUsers,
  updateAdminSettings,
  updateAdminUser,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

function formatBytes(bytes) {
  const value = Number(bytes || 0);

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let converted = value;
  let unit = -1;

  do {
    converted /= 1024;
    unit += 1;
  } while (
    converted >= 1024 &&
    unit < units.length - 1
  );

  return `${converted.toLocaleString("de-DE", {
    maximumFractionDigits: 1,
  })} ${units[unit]}`;
}

function formatDistance(meters) {
  return `${(Number(meters || 0) / 1000).toLocaleString(
    "de-DE",
    {
      maximumFractionDigits: 0,
    },
  )} km`;
}

function OverviewCard({
  label,
  value,
  hint,
}) {
  return (
    <div className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm">
      <div className="text-sm text-fb-muted">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold">
        {value}
      </div>
      {hint && (
        <div className="mt-2 text-xs text-fb-muted">
          {hint}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { accessToken, user } = useAuth();

  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [
        overviewResult,
        usersResult,
        settingsResult,
      ] = await Promise.all([
        getAdminOverview(accessToken),
        getAdminUsers(accessToken),
        getAdminSettings(accessToken),
      ]);

      setOverview(overviewResult);
      setUsers(usersResult);
      setSettings(settingsResult);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Die Administration konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [accessToken]);

  async function saveSystemSettings(event) {
    event.preventDefault();
    setSaving("settings");
    setMessage("");
    setError("");

    try {
      const result = await updateAdminSettings(
        accessToken,
        settings,
      );

      setSettings(result);
      setMessage(
        "Die Systemeinstellungen wurden gespeichert.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Die Einstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      setSaving("");
    }
  }

  function changeUserLocally(userId, changes) {
    setUsers((current) =>
      current.map((entry) =>
        entry.id === userId
          ? {
              ...entry,
              ...changes,
            }
          : entry,
      ),
    );
  }

  async function saveUser(entry) {
    setSaving(entry.id);
    setMessage("");
    setError("");

    try {
      const updated = await updateAdminUser(
        accessToken,
        entry.id,
        {
          role: entry.role,
          status: entry.status,
          forcePasswordChange:
            entry.forcePasswordChange,
        },
      );

      changeUserLocally(entry.id, updated);
      setMessage(
        `Benutzer ${updated.displayName} wurde gespeichert.`,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Der Benutzer konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving("");
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">
        Administration wird geladen …
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold text-fb-accent">
          Administration
        </p>

        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Systemeinstellungen
        </h1>

        <p className="mt-2 text-fb-muted">
          Verwalte Benutzer, Tracking-Standardwerte
          und zentrale Karteneinstellungen.
        </p>
      </header>

      {message && (
        <div className="rounded-xl border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">
          {error}
        </div>
      )}

      {overview && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            label="Benutzer"
            value={overview.totalUsers}
            hint={`${overview.activeUsers} aktiv · ${overview.adminUsers} Administratoren`}
          />

          <OverviewCard
            label="Fahrzeuge"
            value={overview.totalVehicles}
            hint="Nicht archiviert"
          />

          <OverviewCard
            label="Fahrten"
            value={overview.totalTrips}
            hint={formatDistance(
              overview.totalDistanceMeters,
            )}
          />

          <OverviewCard
            label="Datenbank"
            value={formatBytes(
              overview.databaseSizeBytes,
            )}
            hint={`Version ${overview.version}`}
          />
        </section>
      )}

      {settings && (
        <form
          onSubmit={saveSystemSettings}
          className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6"
        >
          <div>
            <h2 className="text-lg font-bold">
              Zentrale Standardwerte
            </h2>

            <p className="mt-1 text-sm text-fb-muted">
              Diese Werte gelten als Vorgabe für neue
              Geräte und Pairing-Vorgänge.
            </p>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <label className="block text-sm font-medium">
              Mindestabstand in Metern
              <input
                type="number"
                min="0"
                value={
                  settings.trackingDefaults
                    .minimumDistanceMeters
                }
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    trackingDefaults: {
                      ...current.trackingDefaults,
                      minimumDistanceMeters:
                        Number(event.target.value),
                    },
                  }))
                }
                className={fieldClass}
              />
            </label>

            <label className="block text-sm font-medium">
              Mindestintervall in Sekunden
              <input
                type="number"
                min="0"
                value={
                  settings.trackingDefaults
                    .minimumTimeSeconds
                }
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    trackingDefaults: {
                      ...current.trackingDefaults,
                      minimumTimeSeconds:
                        Number(event.target.value),
                    },
                  }))
                }
                className={fieldClass}
              />
            </label>

            <label className="block text-sm font-medium">
              Pairing-Gültigkeit in Sekunden
              <input
                type="number"
                min="30"
                max="900"
                value={
                  settings.pairingExpiresSeconds
                }
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    pairingExpiresSeconds:
                      Number(event.target.value),
                  }))
                }
                className={fieldClass}
              />
            </label>

            <label className="block text-sm font-medium">
              Kartenanbieter
              <select
                value={
                  settings.mapDefaults.provider
                }
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    mapDefaults: {
                      ...current.mapDefaults,
                      provider:
                        event.target.value,
                    },
                  }))
                }
                className={fieldClass}
              >
                <option value="osm">
                  OpenStreetMap
                </option>
                <option value="maplibre">
                  MapLibre
                </option>
                <option value="atlas">
                  Eigener Atlas
                </option>
              </select>
            </label>

            <label className="block text-sm font-medium">
              Standard-Breitengrad
              <input
                type="number"
                step="0.000001"
                min="-90"
                max="90"
                value={
                  settings.mapDefaults
                    .defaultLatitude
                }
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    mapDefaults: {
                      ...current.mapDefaults,
                      defaultLatitude:
                        Number(event.target.value),
                    },
                  }))
                }
                className={fieldClass}
              />
            </label>

            <label className="block text-sm font-medium">
              Standard-Längengrad
              <input
                type="number"
                step="0.000001"
                min="-180"
                max="180"
                value={
                  settings.mapDefaults
                    .defaultLongitude
                }
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    mapDefaults: {
                      ...current.mapDefaults,
                      defaultLongitude:
                        Number(event.target.value),
                    },
                  }))
                }
                className={fieldClass}
              />
            </label>

            <label className="block text-sm font-medium">
              Standard-Zoom
              <input
                type="number"
                min="0"
                max="22"
                value={
                  settings.mapDefaults.defaultZoom
                }
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    mapDefaults: {
                      ...current.mapDefaults,
                      defaultZoom:
                        Number(event.target.value),
                    },
                  }))
                }
                className={fieldClass}
              />
            </label>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={saving === "settings"}
              className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
            >
              {saving === "settings"
                ? "Speichern …"
                : "Systemeinstellungen speichern"}
            </button>
          </div>
        </form>
      )}

      <section className="rounded-xl border border-fb-border bg-fb-main shadow-sm">
        <div className="border-b border-fb-border p-5 sm:p-6">
          <h2 className="text-lg font-bold">
            Benutzerverwaltung
          </h2>

          <p className="mt-1 text-sm text-fb-muted">
            Rollen, Status und Passwortwechsel
            verwalten.
          </p>
        </div>

        <div className="divide-y divide-fb-border">
          {users.map((entry) => (
            <article
              key={entry.id}
              className="grid gap-4 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_140px_150px_210px_auto] xl:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold">
                    {entry.displayName}
                  </span>

                  {entry.id === user?.id && (
                    <span className="rounded-full bg-fb-accent-soft px-2 py-0.5 text-xs text-fb-accent">
                      Du
                    </span>
                  )}
                </div>

                <div className="mt-1 truncate text-sm text-fb-muted">
                  {entry.email} · @{entry.username}
                </div>

                <div className="mt-1 text-xs text-fb-muted">
                  {entry.vehicleCount} Fahrzeuge ·{" "}
                  {entry.tripCount} Fahrten
                </div>
              </div>

              <label className="text-xs font-medium text-fb-muted">
                Rolle
                <select
                  value={entry.role}
                  onChange={(event) =>
                    changeUserLocally(entry.id, {
                      role: event.target.value,
                    })
                  }
                  disabled={entry.id === user?.id}
                  className={fieldClass}
                >
                  <option value="user">
                    Benutzer
                  </option>
                  <option value="admin">
                    Administrator
                  </option>
                </select>
              </label>

              <label className="text-xs font-medium text-fb-muted">
                Status
                <select
                  value={entry.status}
                  onChange={(event) =>
                    changeUserLocally(entry.id, {
                      status:
                        event.target.value,
                    })
                  }
                  disabled={entry.id === user?.id}
                  className={fieldClass}
                >
                  <option value="active">
                    Aktiv
                  </option>
                  <option value="disabled">
                    Deaktiviert
                  </option>
                </select>
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={
                    entry.forcePasswordChange
                  }
                  onChange={(event) =>
                    changeUserLocally(entry.id, {
                      forcePasswordChange:
                        event.target.checked,
                    })
                  }
                  className="size-4 accent-[var(--color-accent)]"
                />
                Passwortwechsel erzwingen
              </label>

              <button
                type="button"
                onClick={() => saveUser(entry)}
                disabled={saving === entry.id}
                className="rounded-lg border border-fb-border px-3 py-2.5 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent disabled:opacity-60"
              >
                {saving === entry.id
                  ? "Speichern …"
                  : "Speichern"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
