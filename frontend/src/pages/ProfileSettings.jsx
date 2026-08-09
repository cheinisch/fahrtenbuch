import {
  useEffect,
  useState,
} from "react";
import {
  useSearchParams,
} from "react-router-dom";

import {
  changePassword,
  deleteHomeLocation,
  getDevices,
  getPersonalSettings,
  reverseHomeLocation,
  revokeDevice,
  saveHomeLocation,
  searchHomeLocations,
  updatePersonalSettings,
  updateProfile,
} from "../api/app.js";
import {
  getExportCountryOptions,
} from "../api/countryExport.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import AddNewDeviceModal from "../components/addNewDeviceModal.jsx";
import UserDataTransfer from "../components/UserDataTransfer.jsx";

function Section({
  title,
  description,
  children,
}) {
  return (
    <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
      <div className="mb-6">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-sm text-fb-muted">
          {description}
        </p>
      </div>

      {children}
    </section>
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
        "whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-semibold transition",
        active
          ? "border-fb-accent text-fb-accent"
          : "border-transparent text-fb-muted hover:border-fb-border hover:text-fb-text",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

const labelClass =
  "block text-sm font-medium text-fb-text";

export default function ProfileSettings() {
  const {
    accessToken,
    user,
    updateUser,
  } = useAuth();

  const [
    searchParams,
    setSearchParams,
  ] = useSearchParams();

  const activeTab =
    searchParams.get("tab") === "backup"
      ? "backup"
      : "settings";

  function openTab(tab) {
    const next =
      new URLSearchParams(searchParams);

    if (tab === "backup") {
      next.set("tab", "backup");
    } else {
      next.delete("tab");
    }

    setSearchParams(next, {
      replace: true,
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  const [profile, setProfile] = useState({
    email: "",
    username: "",
    displayName: "",
    locale: "de",
    timezone: "Europe/Berlin",
    themeMode: "system",
  });

  const [
    supportedCountries,
    setSupportedCountries,
  ] = useState([]);

  const [
    homeCountry,
    setHomeCountry,
  ] = useState("DE");

  const [tracking, setTracking] = useState({
    automaticTrackingEnabled: false,
    trackingAccuracyMode: "balanced",
    stopDelaySeconds: 180,
    saveAccuracy: true,
    mapProvider: "osm",
  });

  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmation: "",
  });

  const [devices, setDevices] = useState([]);

  const [addDeviceModalOpen, setAddDeviceModalOpen] =
    useState(false);

  const [homeLocation, setHomeLocation] =
    useState(null);

  const [
    savedHomeLocation,
    setSavedHomeLocation,
  ] = useState(null);

  const [homeQuery, setHomeQuery] =
    useState("");

  const [homeCandidates, setHomeCandidates] =
    useState([]);

  const [homeSearchLoading, setHomeSearchLoading] =
    useState(false);

  const [gpsLoading, setGpsLoading] =
    useState(false);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [
        settingsResult,
        devicesResult,
        countryResult,
      ] = await Promise.all([
        getPersonalSettings(accessToken),
        getDevices(accessToken).catch(() => []),
        getExportCountryOptions(accessToken).catch(() => ({
          countries: [],
          selectedCountry: null,
        })),
      ]);

      setProfile({
        email: settingsResult.user.email,
        username: settingsResult.user.username,
        displayName:
          settingsResult.user.displayName,
        locale: settingsResult.user.locale,
        timezone:
          settingsResult.user.timezone,
        themeMode:
          settingsResult.user.themeMode,
      });

      setTracking({
        automaticTrackingEnabled:
          settingsResult.settings
            .automaticTrackingEnabled,
        trackingAccuracyMode:
          settingsResult.settings
            .trackingAccuracyMode,
        stopDelaySeconds:
          settingsResult.settings.stopDelaySeconds,
        saveAccuracy:
          settingsResult.settings.saveAccuracy,
        mapProvider:
          settingsResult.settings.mapProvider,
      });

      setDevices(devicesResult);

      setSupportedCountries(
        countryResult.countries || [],
      );

      setHomeCountry(
        String(
          settingsResult.settings.homeCountry ||
            countryResult.selectedCountry
              ?.code ||
            "DE",
        ).toUpperCase(),
      );

      const loadedHomeLocation =
        settingsResult.settings.homeLocation ||
        settingsResult.settings.customSettings
          ?.homeLocation ||
        null;

      setHomeLocation(loadedHomeLocation);
      setSavedHomeLocation(loadedHomeLocation);
      setHomeQuery(
        loadedHomeLocation?.address || "",
      );
      setHomeCandidates([]);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Die Einstellungen konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [accessToken]);

  function showSuccess(text) {
    setMessage(text);
    setError("");
  }

  function showError(saveError) {
    setMessage("");
    setError(
      saveError instanceof Error
        ? saveError.message
        : "Die Änderung konnte nicht gespeichert werden.",
    );
  }

  async function findHomeCandidates() {
    const query = homeQuery.trim();

    if (query.length < 3) {
      setError(
        "Bitte gib mindestens drei Zeichen für den Heimatort ein.",
      );
      setMessage("");
      return [];
    }

    setHomeSearchLoading(true);
    setError("");
    setMessage("");

    try {
      const result =
        await searchHomeLocations(
          accessToken,
          query,
        );

      const candidates =
        result.candidates || [];

      setHomeCandidates(candidates);

      if (candidates.length === 0) {
        setError(
          "Für diese Eingabe wurde kein Ort gefunden.",
        );
      }

      return candidates;
    } catch (searchError) {
      showError(searchError);
      return [];
    } finally {
      setHomeSearchLoading(false);
    }
  }

  async function persistHomeLocation(candidate) {
    if (!candidate) {
      setError(
        "Bitte gib einen Heimatort ein oder wähle einen Suchtreffer aus.",
      );
      setMessage("");
      return false;
    }

    const result = await saveHomeLocation(
      accessToken,
      candidate,
    );

    const storedLocation =
      result.homeLocation;

    setHomeLocation(storedLocation);
    setSavedHomeLocation(storedLocation);
    setHomeQuery(storedLocation.address);
    setHomeCandidates([]);

    showSuccess(
      "Der Heimatort wurde gespeichert.",
    );

    return true;
  }

  async function saveEnteredHomeLocation() {
    setSaving("home-save");
    setError("");
    setMessage("");

    try {
      const normalizedQuery =
        homeQuery.trim();

      let candidate =
        homeLocation &&
        homeLocation.address.trim() ===
          normalizedQuery
          ? homeLocation
          : null;

      if (!candidate) {
        const candidates =
          await findHomeCandidates();

        candidate = candidates[0] || null;
      }

      await persistHomeLocation(candidate);
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function removeSavedHomeLocation() {
    setSaving("home-delete");

    try {
      await deleteHomeLocation(accessToken);

      setHomeLocation(null);
      setSavedHomeLocation(null);
      setHomeQuery("");
      setHomeCandidates([]);

      showSuccess(
        "Der Heimatort wurde entfernt.",
      );
    } catch (deleteError) {
      showError(deleteError);
    } finally {
      setSaving("");
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setSaving("profile");

    try {
      const updated = await updateProfile(
        accessToken,
        profile,
      );

      updateUser(updated);
      showSuccess("Profildaten wurden gespeichert.");
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function saveHomeCountry(
    event,
  ) {
    event.preventDefault();
    setSaving("home-country");

    try {
      const updated =
        await updatePersonalSettings(
          accessToken,
          {
            homeCountry,
          },
        );

      setHomeCountry(
        updated.homeCountry ||
          homeCountry,
      );

      showSuccess(
        "Das Heimatland und das Exportprofil wurden gespeichert.",
      );
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function saveTracking(event) {
    event.preventDefault();
    setSaving("tracking");

    try {
      const updated =
        await updatePersonalSettings(
          accessToken,
          tracking,
        );

      setTracking({
        automaticTrackingEnabled:
          updated.automaticTrackingEnabled,
        trackingAccuracyMode:
          updated.trackingAccuracyMode,
        stopDelaySeconds:
          updated.stopDelaySeconds,
        saveAccuracy:
          updated.saveAccuracy,
        mapProvider:
          updated.mapProvider,
      });

      showSuccess(
        "Tracking-Einstellungen wurden gespeichert.",
      );
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function savePassword(event) {
    event.preventDefault();

    if (
      passwords.newPassword !==
      passwords.confirmation
    ) {
      setError(
        "Die neuen Passwörter stimmen nicht überein.",
      );
      return;
    }

    setSaving("password");

    try {
      await changePassword(accessToken, {
        currentPassword:
          passwords.currentPassword,
        newPassword:
          passwords.newPassword,
      });

      setPasswords({
        currentPassword: "",
        newPassword: "",
        confirmation: "",
      });

      showSuccess("Das Passwort wurde geändert.");
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function removeDevice(deviceId) {
    setSaving(deviceId);

    try {
      await revokeDevice(accessToken, deviceId);

      setDevices((current) =>
        current.filter(
          (device) => device.id !== deviceId,
        ),
      );

      showSuccess("Das Gerät wurde abgemeldet.");
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">
        Einstellungen werden geladen …
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold text-fb-accent">
          Benutzerkonto
        </p>

        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Persönliche Einstellungen
        </h1>

        <p className="mt-2 text-fb-muted">
          Verwalte dein Profil, deine
          Tracking-Vorgaben, die Sicherheit
          deines Kontos und dein persönliches
          Backup.
        </p>
      </header>

      <nav
        aria-label="Persönliche Einstellungen"
        className="flex gap-7 overflow-x-auto border-b border-fb-border"
      >
        <TabButton
          active={activeTab === "settings"}
          onClick={() =>
            openTab("settings")
          }
        >
          Profil und Sicherheit
        </TabButton>

        <TabButton
          active={activeTab === "backup"}
          onClick={() =>
            openTab("backup")
          }
        >
          Backup & Restore
        </TabButton>
      </nav>

      {activeTab === "settings" ? (
        <>
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

      <form onSubmit={saveProfile}>
        <Section
          title="Profil"
          description="Persönliche Angaben und Darstellung der Weboberfläche."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <label className={labelClass}>
              Anzeigename
              <input
                type="text"
                value={profile.displayName}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    displayName:
                      event.target.value,
                  }))
                }
                className={fieldClass}
                required
              />
            </label>

            <label className={labelClass}>
              Benutzername
              <input
                type="text"
                value={profile.username}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                className={fieldClass}
                required
              />
            </label>

            <label className={labelClass}>
              E-Mail-Adresse
              <input
                type="email"
                value={profile.email}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                className={fieldClass}
                required
              />
            </label>

            <label className={labelClass}>
              Sprache
              <select
                value={profile.locale}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    locale: event.target.value,
                  }))
                }
                className={fieldClass}
              >
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </label>

            <label className={labelClass}>
              Zeitzone
              <input
                type="text"
                value={profile.timezone}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    timezone:
                      event.target.value,
                  }))
                }
                className={fieldClass}
              />
            </label>

            <label className={labelClass}>
              Darstellung
              <select
                value={profile.themeMode}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    themeMode:
                      event.target.value,
                  }))
                }
                className={fieldClass}
              >
                <option value="system">
                  Systemeinstellung
                </option>
                <option value="light">Hell</option>
                <option value="dark">Dunkel</option>
              </select>
            </label>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={saving === "profile"}
              className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
            >
              {saving === "profile"
                ? "Speichern …"
                : "Profil speichern"}
            </button>
          </div>
        </Section>
      </form>


      <form onSubmit={saveHomeCountry}>
        <Section
          title="Heimatland und Steuerexport"
          description="Das gewählte Land bestimmt Aufbau, Sprache, Einheit und Hinweise des PDF-Exports."
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className={labelClass}>
              Heimatland
              <select
                value={homeCountry}
                onChange={(event) =>
                  setHomeCountry(
                    event.target.value,
                  )
                }
                className={fieldClass}
              >
                {supportedCountries.map(
                  (country) => (
                    <option
                      key={country.code}
                      value={country.code}
                    >
                      {country.name}
                      {country.localName &&
                      country.localName !==
                        country.name
                        ? ` (${country.localName})`
                        : ""}
                    </option>
                  ),
                )}
              </select>
            </label>

            <div className="rounded-lg border border-fb-border bg-fb-surface p-4">
              <div className="text-sm font-semibold text-fb-text">
                Aktives Exportprofil
              </div>

              {(() => {
                const selected =
                  supportedCountries.find(
                    (country) =>
                      country.code ===
                      homeCountry,
                  );

                if (!selected) {
                  return (
                    <p className="mt-2 text-sm text-fb-muted">
                      Das Länderprofil wird
                      geladen.
                    </p>
                  );
                }

                return (
                  <>
                    <p className="mt-2 text-sm text-fb-text">
                      {selected.reportTitle}
                    </p>

                    <p className="mt-1 text-xs text-fb-muted">
                      Zeitraum:{" "}
                      {
                        selected.taxYearLabel
                      }
                      {" · "}
                      Einheit:{" "}
                      {
                        selected.distanceUnit
                      }
                      {" · "}
                      Währung:{" "}
                      {selected.currency}
                    </p>
                  </>
                );
              })()}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={
                saving === "home-country" ||
                supportedCountries.length === 0
              }
              className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
            >
              {saving === "home-country"
                ? "Speichern …"
                : "Heimatland speichern"}
            </button>
          </div>
        </Section>
      </form>

      <form onSubmit={saveTracking}>
        <Section
          title="Tracking"
          description="Vorgaben für die Android-App und die automatische Fahrterkennung."
        >
          <div className="space-y-5">
            <label className="flex items-start justify-between gap-6 rounded-lg border border-fb-border bg-fb-surface p-4">
              <span>
                <span className="block text-sm font-semibold">
                  Automatisches Tracking
                </span>
                <span className="mt-1 block text-sm text-fb-muted">
                  Fahrten automatisch starten, sobald ein
                  bekanntes Fahrzeug erkannt wird.
                </span>
              </span>

              <input
                type="checkbox"
                checked={
                  tracking.automaticTrackingEnabled
                }
                onChange={(event) =>
                  setTracking((current) => ({
                    ...current,
                    automaticTrackingEnabled:
                      event.target.checked,
                  }))
                }
                className="mt-1 size-5 accent-[var(--color-accent)]"
              />
            </label>

            <div className="grid gap-5 sm:grid-cols-2">
              <label className={labelClass}>
                Genauigkeitsmodus
                <select
                  value={
                    tracking.trackingAccuracyMode
                  }
                  onChange={(event) =>
                    setTracking((current) => ({
                      ...current,
                      trackingAccuracyMode:
                        event.target.value,
                    }))
                  }
                  className={fieldClass}
                >
                  <option value="high">
                    Hohe Genauigkeit
                  </option>
                  <option value="balanced">
                    Ausgeglichen
                  </option>
                  <option value="battery">
                    Akkuschonend
                  </option>
                </select>
              </label>

              <label className={labelClass}>
                Stop-Verzögerung in Sekunden
                <input
                  type="number"
                  min="0"
                  max="3600"
                  value={tracking.stopDelaySeconds}
                  onChange={(event) =>
                    setTracking((current) => ({
                      ...current,
                      stopDelaySeconds:
                        Number(event.target.value),
                    }))
                  }
                  className={fieldClass}
                />
              </label>

              <label className={labelClass}>
                Kartenanbieter
                <select
                  value={tracking.mapProvider}
                  onChange={(event) =>
                    setTracking((current) => ({
                      ...current,
                      mapProvider:
                        event.target.value,
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

              <label className="flex items-center gap-3 self-end rounded-lg border border-fb-border bg-fb-surface px-4 py-3">
                <input
                  type="checkbox"
                  checked={tracking.saveAccuracy}
                  onChange={(event) =>
                    setTracking((current) => ({
                      ...current,
                      saveAccuracy:
                        event.target.checked,
                    }))
                  }
                  className="size-5 accent-[var(--color-accent)]"
                />
                <span className="text-sm font-medium">
                  GPS-Genauigkeit speichern
                </span>
              </label>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={saving === "tracking"}
              className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
            >
              {saving === "tracking"
                ? "Speichern …"
                : "Tracking speichern"}
            </button>
          </div>
        </Section>
      </form>


      <Section
        title="Heimatort"
        description="Wird auf dem Dashboard als Kartenmittelpunkt verwendet, wenn noch keine Fahrt vorhanden ist."
      >
        {savedHomeLocation && (
          <div className="mb-5 rounded-lg border border-fb-border bg-fb-surface p-4">
            <div className="text-sm font-semibold">
              Aktuell gespeichert
            </div>

            <div className="mt-1 text-sm text-fb-text">
              {savedHomeLocation.address}
            </div>

            <div className="mt-1 text-xs text-fb-muted">
              {Number(
                savedHomeLocation.latitude,
              ).toFixed(6)}
              ,{" "}
              {Number(
                savedHomeLocation.longitude,
              ).toFixed(6)}
              {" · "}
              {savedHomeLocation.source === "gps"
                ? "per GPS bestimmt"
                : "manuell gewählt"}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className={labelClass}>
            Adresse oder Ort
            <input
              type="text"
              value={homeQuery}
              onChange={(event) => {
                const value =
                  event.target.value;

                setHomeQuery(value);
                setHomeCandidates([]);

                if (
                  homeLocation?.address !==
                  value.trim()
                ) {
                  setHomeLocation(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveEnteredHomeLocation();
                }
              }}
              placeholder="z. B. Geisenheim"
              className={fieldClass}
            />
          </label>

          <button
            type="button"
            disabled={
              homeSearchLoading ||
              homeQuery.trim().length < 3
            }
            onClick={findHomeCandidates}
            className="self-end rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent disabled:opacity-60"
          >
            {homeSearchLoading
              ? "Suche …"
              : "Adresse suchen"}
          </button>
        </div>

        {homeCandidates.length > 0 && (
          <div className="mt-4 divide-y divide-fb-border overflow-hidden rounded-lg border border-fb-border">
            {homeCandidates.map(
              (candidate, index) => (
                <button
                  key={`${candidate.latitude}-${candidate.longitude}-${index}`}
                  type="button"
                  onClick={() => {
                    setHomeLocation(candidate);
                    setHomeQuery(
                      candidate.address,
                    );
                    setHomeCandidates([]);
                    setError("");
                    setMessage(
                      "Adresse ausgewählt. Klicke auf „Heimatort speichern“.",
                    );
                  }}
                  className="block w-full bg-fb-main px-4 py-3 text-left transition hover:bg-fb-surface"
                >
                  <div className="text-sm font-medium">
                    {candidate.address}
                  </div>

                  <div className="mt-1 text-xs text-fb-muted">
                    {Number(
                      candidate.latitude,
                    ).toFixed(6)}
                    ,{" "}
                    {Number(
                      candidate.longitude,
                    ).toFixed(6)}
                  </div>
                </button>
              ),
            )}
          </div>
        )}

        {homeLocation &&
          homeLocation.address !==
            savedHomeLocation?.address && (
            <div className="mt-4 rounded-lg border border-fb-accent bg-fb-accent-soft p-4">
              <div className="text-sm font-semibold text-fb-accent">
                Zum Speichern ausgewählt
              </div>

              <div className="mt-1 text-sm text-fb-text">
                {homeLocation.address}
              </div>
            </div>
          )}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={gpsLoading}
            onClick={() => {
              if (!navigator.geolocation) {
                setError(
                  "Dieses Gerät unterstützt keine Standortbestimmung.",
                );
                return;
              }

              setGpsLoading(true);
              setError("");
              setMessage("");

              navigator.geolocation.getCurrentPosition(
                async (position) => {
                  try {
                    const result =
                      await reverseHomeLocation(
                        accessToken,
                        {
                          latitude:
                            position.coords
                              .latitude,
                          longitude:
                            position.coords
                              .longitude,
                        },
                      );

                    setHomeLocation(
                      result.candidate,
                    );

                    setHomeQuery(
                      result.candidate.address,
                    );

                    setHomeCandidates([]);

                    setMessage(
                      "Der aktuelle Standort wurde ermittelt. Klicke auf „Heimatort speichern“.",
                    );
                  } catch (gpsError) {
                    showError(gpsError);
                  } finally {
                    setGpsLoading(false);
                  }
                },
                (gpsError) => {
                  const messages = {
                    1: "Der Zugriff auf den Standort wurde abgelehnt.",
                    2: "Der Standort konnte nicht bestimmt werden.",
                    3: "Die Standortbestimmung hat zu lange gedauert.",
                  };

                  setError(
                    messages[gpsError.code] ||
                      "Der Standort konnte nicht bestimmt werden.",
                  );

                  setGpsLoading(false);
                },
                {
                  enableHighAccuracy: true,
                  timeout: 15_000,
                  maximumAge: 0,
                },
              );
            }}
            className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent disabled:opacity-60"
          >
            {gpsLoading
              ? "Standort wird bestimmt …"
              : "Aktuellen Standort verwenden"}
          </button>

          {!window.isSecureContext && (
            <p className="text-xs text-fb-danger">
              GPS im Browser benötigt in der
              Regel HTTPS oder localhost.
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {savedHomeLocation && (
            <button
              type="button"
              disabled={
                saving === "home-delete" ||
                saving === "home-save"
              }
              onClick={removeSavedHomeLocation}
              className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-danger transition hover:border-fb-danger disabled:opacity-60"
            >
              {saving === "home-delete"
                ? "Entfernen …"
                : "Heimatort entfernen"}
            </button>
          )}

          <button
            type="button"
            disabled={
              homeQuery.trim().length < 3 ||
              homeSearchLoading ||
              saving === "home-save" ||
              saving === "home-delete"
            }
            onClick={saveEnteredHomeLocation}
            className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
          >
            {saving === "home-save"
              ? "Speichern …"
              : "Heimatort speichern"}
          </button>
        </div>
      </Section>

      <form onSubmit={savePassword}>
        <Section
          title="Passwort"
          description="Nach einer Änderung werden alle anderen Sitzungen beendet."
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <label className={labelClass}>
              Aktuelles Passwort
              <input
                type="password"
                value={passwords.currentPassword}
                onChange={(event) =>
                  setPasswords((current) => ({
                    ...current,
                    currentPassword:
                      event.target.value,
                  }))
                }
                className={fieldClass}
                required
              />
            </label>

            <label className={labelClass}>
              Neues Passwort
              <input
                type="password"
                value={passwords.newPassword}
                onChange={(event) =>
                  setPasswords((current) => ({
                    ...current,
                    newPassword:
                      event.target.value,
                  }))
                }
                className={fieldClass}
                minLength={10}
                required
              />
            </label>

            <label className={labelClass}>
              Passwort bestätigen
              <input
                type="password"
                value={passwords.confirmation}
                onChange={(event) =>
                  setPasswords((current) => ({
                    ...current,
                    confirmation:
                      event.target.value,
                  }))
                }
                className={fieldClass}
                minLength={10}
                required
              />
            </label>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={saving === "password"}
              className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
            >
              {saving === "password"
                ? "Ändern …"
                : "Passwort ändern"}
            </button>
          </div>
        </Section>
      </form>

      <Section
        title="Sicherheit"
        description="Status der zusätzlichen Anmeldeverfahren."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-fb-border bg-fb-surface p-4">
            <div className="font-semibold">
              Zwei-Faktor-Authentifizierung
            </div>
            <div className="mt-1 text-sm text-fb-muted">
              {user?.totpEnabled
                ? "Für dein Konto aktiviert."
                : "Für dein Konto noch nicht aktiviert."}
            </div>
          </div>

          <div className="rounded-lg border border-fb-border bg-fb-surface p-4">
            <div className="font-semibold">
              Passkeys
            </div>
            <div className="mt-1 text-sm text-fb-muted">
              Die Verwaltung der Passkeys folgt mit
              der WebAuthn-Anbindung.
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Geräte und Sitzungen"
        description="Geräte, die sich mit deinem Konto angemeldet haben."
      >
        <div className="mb-5 flex justify-end">
          <button
            type="button"
            onClick={() =>
              setAddDeviceModalOpen(true)
            }
            className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent"
          >
            Neues Gerät hinzufügen
          </button>
        </div>

        <div className="divide-y divide-fb-border">
          {devices.length === 0 ? (
            <div className="py-6 text-sm text-fb-muted">
              Keine Geräte gefunden.
            </div>
          ) : (
            devices.map((device) => (
              <div
                key={device.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {device.deviceName}

                    {device.isCurrent && (
                      <span className="rounded-full bg-fb-accent-soft px-2 py-0.5 text-xs text-fb-accent">
                        Aktuell
                      </span>
                    )}

                    {device.revokedAt && (
                      <span className="rounded-full border border-fb-border px-2 py-0.5 text-xs text-fb-muted">
                        Abgemeldet
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-sm text-fb-muted">
                    {device.platform || device.deviceType}
                    {device.lastSeenAt
                      ? ` · zuletzt ${new Intl.DateTimeFormat(
                          "de-DE",
                          {
                            dateStyle: "medium",
                            timeStyle: "short",
                          },
                        ).format(
                          new Date(device.lastSeenAt),
                        )}`
                      : ""}
                  </div>
                </div>

                {!device.isCurrent &&
                  !device.revokedAt && (
                    <button
                      type="button"
                      onClick={() =>
                        removeDevice(device.id)
                      }
                      disabled={
                        saving === device.id
                      }
                      className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold text-fb-text hover:border-fb-danger hover:text-fb-danger disabled:opacity-60"
                    >
                      {saving === device.id
                        ? "Abmelden …"
                        : "Gerät abmelden"}
                    </button>
                  )}
              </div>
            ))
          )}
        </div>
      </Section>

      <AddNewDeviceModal
        open={addDeviceModalOpen}
        onClose={() =>
          setAddDeviceModalOpen(false)
        }
        onPaired={async () => {
          const updatedDevices =
            await getDevices(accessToken);

          setDevices(updatedDevices);
          showSuccess(
            "Das neue Gerät wurde erfolgreich verbunden.",
          );
        }}
      />
        </>
      ) : (
        <UserDataTransfer />
      )}
    </div>
  );
}
