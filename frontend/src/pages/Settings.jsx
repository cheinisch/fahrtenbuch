import PageHeader from "../components/PageHeader.jsx";
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
import { useI18n } from "../i18n/I18nProvider.jsx";
import AdminDataTransfer from "../components/admin/AdminDataTransfer.jsx";
import UserManagement from "../components/users/UserManagement.jsx";
import JobManagement from "../components/admin/JobManagement.jsx";
import GeocodingSettings from "../components/admin/GeocodingSettings.jsx";
import MailSettingsForm from "../components/admin/MailSettingsForm.jsx";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

function formatBytes(bytes, locale) {
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

  return `${converted.toLocaleString(locale, {
    maximumFractionDigits: 1,
  })} ${units[unit]}`;
}

function formatDistance(meters, locale) {
  return `${(
    Number(meters || 0) / 1000
  ).toLocaleString(locale, {
    maximumFractionDigits: 0,
  })} km`;
}

function OverviewCard({
  label,
  value,
  hint,
  locale,
}) {
  return (
    <div className="rounded-xl border border-fb-border bg-fb-main p-[18px]">
      <div className="text-[13px] text-fb-muted">
        {label}
      </div>

      <div className="mt-1 text-[28px] font-bold leading-tight">
        {typeof value === "number" ? value.toLocaleString(locale) : value}
      </div>

      {hint && (
        <div className="mt-0.5 text-xs text-fb-muted">
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
        "h-11 whitespace-nowrap border-b-2 text-sm transition",
        active
          ? "border-fb-accent font-semibold text-fb-accent-strong"
          : "border-transparent font-medium text-fb-muted hover:text-fb-text",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function Settings() {
  const { accessToken } = useAuth();
  const { t, locale } = useI18n();

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
            : t("admin.loadFailed"),
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
      // Map-Matching wird im Reiter „Geocoding“ gepflegt; hier nicht mitsenden,
      // sonst würde ein veralteter Stand die dortige Einstellung überschreiben.
      const { mapMatching: _mapMatching, ...systemSettings } = settings;
      const result =
        await updateAdminSettings(
          accessToken,
          systemSettings,
        );

      setSettings(result);
      setMessage(
        t("admin.saved"),
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("admin.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">
        {t("admin.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("admin.title")}
        subtitle={t("admin.subtitle")}
      />

      <nav className="flex gap-7 overflow-x-auto border-b border-fb-border">
        <TabButton
          active={activeTab === "system"}
          onClick={() =>
            setActiveTab("system")
          }
        >
          {t("admin.tabSystem")}
        </TabButton>

        <TabButton
          active={activeTab === "users"}
          onClick={() =>
            setActiveTab("users")
          }
        >
          {t("admin.tabUsers")}
        </TabButton>

        <TabButton active={activeTab === "mail"} onClick={() => setActiveTab("mail")}>
          {t("admin.tabMail")}
        </TabButton>

        <TabButton active={activeTab === "geocoding"} onClick={() => setActiveTab("geocoding")}>
          {t("admin.tabGeocoding")}
        </TabButton>

        <TabButton active={activeTab === "jobs"} onClick={() => setActiveTab("jobs")}>
          {t("admin.tabJobs")}
        </TabButton>

        <TabButton
          active={activeTab === "backup"}
          onClick={() =>
            setActiveTab("backup")
          }
        >
          {t("admin.tabBackup")}
        </TabButton>
      </nav>

      {activeTab === "system" ? (
        <div className="space-y-8">
          {message && (
            <div className="rounded-xl border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent-strong">
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
                locale={locale}
                label={t("admin.users")}
                value={overview.totalUsers}
                hint={t("admin.usersHint", { active: overview.activeUsers, admins: overview.adminUsers })}
              />

              <OverviewCard
                locale={locale}
                label={t("admin.vehicles")}
                value={overview.totalVehicles}
                hint={t("admin.vehiclesHint")}
              />

              <OverviewCard
                locale={locale}
                label={t("admin.trips")}
                value={overview.totalTrips}
                hint={formatDistance(
                  overview.totalDistanceMeters,
                  locale,
                )}
              />

              <OverviewCard
                locale={locale}
                label={t("admin.database")}
                value={formatBytes(
                  overview.databaseSizeBytes,
                  locale,
                )}
                hint={t("admin.version", { version: overview.version })}
              />
            </section>
          )}

          {settings && (
            <form
              onSubmit={saveSystemSettings}
              className="rounded-xl border border-fb-border bg-fb-main p-[22px]"
            >
              <div>
                <h2 className="text-lg font-bold">
                  {t("admin.defaultsTitle")}
                </h2>

                <p className="mt-1 text-sm text-fb-muted">
                  {t("admin.defaultsHint")}
                </p>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                <label className="block text-sm font-medium">
                  {t("language.globalTitle")}
                  <select value={settings.defaultLanguage || "de"} onChange={(event)=>setSettings((current)=>({...current,defaultLanguage:event.target.value}))} className={fieldClass}>
                    <option value="de">Deutsch</option><option value="en">English</option>
                  </select>
                  <span className="mt-1 block text-xs text-fb-muted">{t("language.globalHint")}</span>
                </label>

                <label className="block text-sm font-medium">
                  {t("admin.minDistance")}
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
                  {t("admin.minInterval")}
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
                  {t("admin.pairingExpiry")}
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
                  {t("admin.mapProvider")}
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
                      {t("admin.providerOsm")}
                    </option>
                    <option value="protomaps">
                      {t("admin.providerProtomaps")}
                    </option>
                  </select>
                  <span className="mt-1 block text-xs text-fb-muted">
                    {t("admin.mapProviderHint")}
                  </span>
                </label>

                <label className="block text-sm font-medium">
                  {t("admin.defaultLatitude")}
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
                  {t("admin.defaultLongitude")}
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
                  {t("admin.defaultZoom")}
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

                <div className="block text-sm font-medium sm:col-span-2 xl:col-span-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={settings.gravatarEnabled !== false}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          gravatarEnabled: event.target.checked,
                        }))
                      }
                      className="mt-0.5 size-4 accent-fb-accent"
                    />
                    <span>
                      {t("admin.gravatar")}
                      <span className="mt-1 block text-xs font-normal text-fb-muted">
                        {t("admin.gravatarHint")}
                        {settings.gravatarSource === "environment" ? ` ${t("admin.gravatarFromEnv")}` : ""}
                      </span>
                    </span>
                  </label>
                </div>

                {settings.mapDefaults.provider === "protomaps" && (
                  <>
                    <label className="block text-sm font-medium sm:col-span-2">
                      {t("admin.tileServer")}
                      <input
                        type="url"
                        placeholder={t("admin.tileServerPlaceholder")}
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
                        {t("admin.tileServerHint")}
                      </span>
                    </label>

                    <label className="block text-sm font-medium">
                      {t("admin.flavor")}
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
                        <option value="auto">{t("admin.flavorAuto")}</option>
                        <option value="light">{t("admin.flavorLight")}</option>
                        <option value="dark">{t("admin.flavorDark")}</option>
                        <option value="grayscale">{t("admin.flavorGrayscale")}</option>
                        <option value="white">{t("admin.flavorWhite")}</option>
                        <option value="black">{t("admin.flavorBlack")}</option>
                      </select>
                    </label>

                    <label className="block text-sm font-medium sm:col-span-2">
                      {t("admin.assets")}
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
                        {t("admin.assetsHint")}
                      </span>
                    </label>
                  </>
                )}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
                >
                  {saving
                    ? t("common.saving")
                    : t("admin.save")}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : activeTab === "users" ? (
        <UserManagement onUsersChanged={loadOverview} />
      ) : activeTab === "mail" ? (
        <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
          <h2 className="text-lg font-bold">{t("mailSettings.title")}</h2>
          <p className="mt-1 text-sm text-fb-muted">{t("mailSettings.subtitle")}</p>
          <div className="mt-6">
            <MailSettingsForm standalone />
          </div>
        </section>
      ) : activeTab === "geocoding" ? (
        <GeocodingSettings />
      ) : activeTab === "jobs" ? (
        <JobManagement />
      ) : (
        <AdminDataTransfer />
      )}
    </div>
  );
}
