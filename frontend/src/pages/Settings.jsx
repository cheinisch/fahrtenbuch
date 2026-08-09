import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  getAdminOverview,
  getAdminSettings,
  updateAdminSettings,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import AdminDataTransfer from "../components/admin/AdminDataTransfer.jsx";
import UserManagement from "../components/users/UserManagement.jsx";

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
  return `${(
    Number(meters || 0) / 1000
  ).toLocaleString("de-DE", {
    maximumFractionDigits: 0,
  })} km`;
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

function TabButton({
  active,
  onClick,
  children,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "border-b-2 px-1 pb-3 text-sm font-semibold transition",
        active
          ? "border-fb-accent text-fb-accent"
          : "border-transparent text-fb-muted hover:border-fb-border hover:text-fb-text",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function Settings() {
  const { accessToken } = useAuth();

  const [activeTab, setActiveTab] =
    useState("system");

  const [overview, setOverview] =
    useState(null);

  const [settings, setSettings] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const loadOverview = useCallback(
    async () => {
      const result =
        await getAdminOverview(accessToken);

      setOverview(result);
    },
    [accessToken],
  );

  const loadSystemData = useCallback(
    async () => {
      setLoading(true);
      setError("");

      try {
        const [
          overviewResult,
          settingsResult,
        ] = await Promise.all([
          getAdminOverview(accessToken),
          getAdminSettings(accessToken),
        ]);

        setOverview(overviewResult);
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
    },
    [accessToken],
  );

  useEffect(() => {
    loadSystemData();
  }, [loadSystemData]);

  async function saveSystemSettings(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const result =
        await updateAdminSettings(
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
      setSaving(false);
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
          Verwalte zentrale Vorgaben,
          Benutzerkonten und das vollständige
          System-Backup.
        </p>
      </header>

      <nav className="flex gap-7 overflow-x-auto border-b border-fb-border">
        <TabButton
          active={activeTab === "system"}
          onClick={() =>
            setActiveTab("system")
          }
        >
          Übersicht und System
        </TabButton>

        <TabButton
          active={activeTab === "users"}
          onClick={() =>
            setActiveTab("users")
          }
        >
          Benutzerverwaltung
        </TabButton>

        <TabButton
          active={activeTab === "backup"}
          onClick={() =>
            setActiveTab("backup")
          }
        >
          Backup & Restore
        </TabButton>
      </nav>

      {activeTab === "system" ? (
        <div className="space-y-8">
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
                  Diese Werte gelten als Vorgabe
                  für neue Geräte und
                  Pairing-Vorgänge.
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
                            Number(
                              event.target.value,
                            ),
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
                            Number(
                              event.target.value,
                            ),
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
                          Number(
                            event.target.value,
                          ),
                      }))
                    }
                    className={fieldClass}
                  />
                </label>

                <label className="block text-sm font-medium">
                  Kartenanbieter
                  <select
                    value={settings.mapDefaults?.provider || "osm"}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        mapDefaults: {
                          ...current.mapDefaults,
                          provider:
                            event.target.value,
                          protomapsTileServerUrl:
                            current.mapDefaults.protomapsTileServerUrl || "",
                          protomapsAssetsUrl:
                            current.mapDefaults.protomapsAssetsUrl || "",
                          protomapsFlavor:
                            current.mapDefaults.protomapsFlavor || "auto",
                        },
                      }))
                    }
                    className={fieldClass}
                  >
                    <option value="osm">
                      OpenStreetMap (Raster)
                    </option>
                    <option value="protomaps">
                      Protomaps (eigener Tileserver)
                    </option>
                  </select>
                  <span className="mt-1 block text-xs text-fb-muted">
                    Die Darstellung erfolgt immer mit MapLibre GL JS.
                  </span>
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
                            Number(
                              event.target.value,
                            ),
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
                            Number(
                              event.target.value,
                            ),
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
                      settings.mapDefaults
                        .defaultZoom
                    }
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        mapDefaults: {
                          ...current.mapDefaults,
                          defaultZoom:
                            Number(
                              event.target.value,
                            ),
                        },
                      }))
                    }
                    className={fieldClass}
                  />
                </label>

                {settings.mapDefaults.provider === "protomaps" && (
                  <>
                    <label className="block text-sm font-medium sm:col-span-2">
                      Protomaps-Tileserver
                      <input
                        type="url"
                        placeholder="http://172.16.2.20:8080 oder http://172.16.2.20:8080/europe.json"
                        value={settings.mapDefaults.protomapsTileServerUrl || ""}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            mapDefaults: {
                              ...current.mapDefaults,
                              protomapsTileServerUrl: event.target.value,
                            },
                          }))
                        }
                        className={fieldClass}
                      />
                      <span className="mt-1 block text-xs text-fb-muted">
                        Adresse deines eigenen Protomaps-Tileservers. Du kannst entweder die Basis-URL oder direkt den TileJSON-Endpunkt eintragen. Bei einer Basis-URL wird /europe.json verwendet.
                      </span>
                    </label>

                    <label className="block text-sm font-medium">
                      Protomaps-Kartenstil
                      <select
                        value={settings.mapDefaults.protomapsFlavor || "auto"}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            mapDefaults: {
                              ...current.mapDefaults,
                              protomapsFlavor: event.target.value,
                            },
                          }))
                        }
                        className={fieldClass}
                      >
                        <option value="auto">Automatisch (App-Theme)</option>
                        <option value="light">Hell</option>
                        <option value="dark">Dunkel</option>
                        <option value="grayscale">Graustufen</option>
                        <option value="white">Weiß</option>
                        <option value="black">Schwarz</option>
                      </select>
                    </label>

                    <label className="block text-sm font-medium sm:col-span-2">
                      Eigene Protomaps-Assets (optional)
                      <input
                        type="url"
                        placeholder="http://172.16.2.20/protomaps-assets"
                        value={settings.mapDefaults.protomapsAssetsUrl || ""}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            mapDefaults: {
                              ...current.mapDefaults,
                              protomapsAssetsUrl: event.target.value,
                            },
                          }))
                        }
                        className={fieldClass}
                      />
                      <span className="mt-1 block text-xs text-fb-muted">
                        Leer lassen, um die öffentlichen Protomaps-Fonts und -Sprites zu verwenden. Für vollständig selbst gehostete Karten hier die Basis-URL der Assets eintragen.
                      </span>
                    </label>
                  </>
                )}

                <label className="block text-sm font-medium">
                  Map-Matching
                  <select
                    value={
                      settings.mapMatching
                        ?.provider || "disabled"
                    }
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        mapMatching: {
                          provider:
                            event.target.value,
                          osrmUrl:
                            current.mapMatching
                              ?.osrmUrl || "",
                          valhallaUrl:
                            current.mapMatching
                              ?.valhallaUrl || "",
                        },
                      }))
                    }
                    className={fieldClass}
                  >
                    <option value="disabled">
                      Kein Map-Matching
                    </option>
                    <option value="osrm">
                      OSRM
                    </option>
                    <option value="valhalla">
                      Valhalla
                    </option>
                  </select>
                </label>

                <label className="block text-sm font-medium">
                  OSRM Serveradresse
                  <input
                    type="text"
                    placeholder="http://192.168.1.10:5000"
                    value={
                      settings.mapMatching
                        ?.osrmUrl || ""
                    }
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        mapMatching: {
                          provider:
                            current.mapMatching
                              ?.provider ||
                            "disabled",
                          osrmUrl:
                            event.target.value,
                          valhallaUrl:
                            current.mapMatching
                              ?.valhallaUrl || "",
                        },
                      }))
                    }
                    className={fieldClass}
                  />
                  <span className="mt-1 block text-xs font-normal text-fb-muted">
                    IP/Hostname inklusive Protokoll und Port, z. B. http://192.168.1.10:5000
                  </span>
                </label>

                <label className="block text-sm font-medium">
                  Valhalla Serveradresse
                  <input
                    type="text"
                    placeholder="http://192.168.1.11:8002"
                    value={
                      settings.mapMatching
                        ?.valhallaUrl || ""
                    }
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        mapMatching: {
                          provider:
                            current.mapMatching
                              ?.provider ||
                            "disabled",
                          osrmUrl:
                            current.mapMatching
                              ?.osrmUrl || "",
                          valhallaUrl:
                            event.target.value,
                        },
                      }))
                    }
                    className={fieldClass}
                  />
                  <span className="mt-1 block text-xs font-normal text-fb-muted">
                    IP/Hostname inklusive Protokoll und Port, z. B. http://192.168.1.11:8002
                  </span>
                </label>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
                >
                  {saving
                    ? "Speichern …"
                    : "Systemeinstellungen speichern"}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : activeTab === "users" ? (
        <UserManagement
          onUsersChanged={loadOverview}
        />
      ) : (
        <AdminDataTransfer />
      )}
    </div>
  );
}
