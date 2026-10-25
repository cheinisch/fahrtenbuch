import { useI18n } from "../i18n/I18nProvider.jsx";
import { codeKey } from "../i18n/translate.js";
import {
  useEffect,
  useState,
} from "react";
import {
  useSearchParams,
  Link,
} from "react-router-dom";

import {
  changePassword,
  deleteHomeLocation,
  deleteWorkLocation,
  getDevices,
  getPersonalSettings,
  reverseHomeLocation,
  revokeDevice,
  saveHomeLocation,
  saveWorkLocation,
  searchHomeLocations,
  updatePersonalSettings,
  updateProfile,
  getSavedPlaces,
  createSavedPlace,
  deleteSavedPlace,
  sendMonthlyReport,
} from "../api/app.js";
import {
  getExportCountryOptions,
} from "../api/countryExport.js";
import {
  deletePasskey,
  getPasskeyRegistrationOptions,
  getPasskeys,
  renamePasskey,
  verifyPasskeyRegistration,
} from "../api/passkeys.js";
import { getAuthMethods, getOAuthProviders } from "../api/auth.js";
import {
  getLinkedAccounts,
  startAccountLink,
  unlinkAccount,
} from "../api/oauth.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { createPasskey } from "../lib/webauthn.js";
import AddNewDeviceModal from "../components/addNewDeviceModal.jsx";
import UserDataTransfer from "../components/UserDataTransfer.jsx";
import DawarichConnectionSection from "../components/users/DawarichConnectionSection.jsx";
import { DEFAULT_ROUTE_COLORS } from "../lib/routeColors.js";
import PageHeader from "../components/PageHeader.jsx";
import { GRAVATAR_SETTING_EVENT } from "../lib/gravatar.js";
import { useFeatures } from "../lib/features.jsx";

// Gruppen der Abschnittsnavigation (wie im Mockup); der Anker zeigt auf den
// ersten Abschnitt der Gruppe, SECTION_GROUP ordnet jeden Abschnitt zu.
const SETTINGS_GROUPS = [
  ["profile", "profile.nav.profile"],
  ["home", "profile.nav.places"],
  ["tracking", "profile.nav.tracking"],
  ["notifications", "profile.nav.notifications"],
  ["credentials", "profile.nav.security"],
  ["devices", "profile.nav.devices"],
];

const SECTION_GROUP = {
  profile: "profile", language: "profile", country: "profile",
  home: "home", work: "home", recognition: "home", places: "home",
  tracking: "tracking", mapMatching: "tracking", dawarich: "tracking",
  notifications: "notifications",
  credentials: "credentials", security: "credentials",
  devices: "devices",
};

function Section({
  id,
  title,
  description,
  children,
}) {
  return (
    <section id={id ? `section-${id}` : undefined} data-section={id} className="scroll-mt-6 rounded-xl border border-fb-border bg-fb-main p-[22px]">
      <div className="mb-4">
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

function formatSafeDate(value, fallback = "–") {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  // Modul-Helfer ohne Hook: Sprache kommt aus <html lang>, das der I18nProvider setzt.
  return new Intl.DateTimeFormat(document.documentElement.lang || "de", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

const labelClass =
  "block text-sm font-medium text-fb-text";

export default function ProfileSettings() {
  const { t, locale } = useI18n();
  const { features } = useFeatures();

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
    ["backup", "units"].includes(searchParams.get("tab"))
      ? searchParams.get("tab")
      : "settings";

  // Aktive Gruppe in der Abschnittsnavigation: der oberste sichtbare Abschnitt.
  const [activeGroup, setActiveGroup] = useState("profile");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const group = visible && SECTION_GROUP[visible.target.dataset.section];
      if (group) setActiveGroup(group);
    }, { rootMargin: "0px 0px -60% 0px" });
    document.querySelectorAll("[data-section]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  });

  function openTab(tab) {
    const next =
      new URLSearchParams(searchParams);

    if (tab === "backup" || tab === "units") {
      next.set("tab", tab);
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

  const [personalLanguage, setPersonalLanguage] = useState("");
  const [distanceUnit, setDistanceUnit] = useState("km");
  const [dateFormat, setDateFormat] = useState("EU");
  const [timeFormat, setTimeFormat] = useState("24h");
  const [gravatarEnabled, setGravatarEnabled] = useState(true);
  const [gravatarAvailable, setGravatarAvailable] = useState(true);
  const [monthlyReportEnabled, setMonthlyReportEnabled] = useState(true);
  const [monthlyReportAvailable, setMonthlyReportAvailable] = useState(false);
  const [mapMatchingEnabled, setMapMatchingEnabled] = useState(true);
  const [mapMatchingAvailable, setMapMatchingAvailable] = useState(false);
  const [speedUnit, setSpeedUnit] = useState("kmh");

  const [tracking, setTracking] = useState({
    automaticTrackingEnabled: false,
    trackingAccuracyMode: "balanced",
    stopDelaySeconds: 180,
    saveAccuracy: true,
    mapProvider: "osm",
    mapRouteColors: {},
  });

  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmation: "",
  });

  const [devices, setDevices] = useState([]);
  const [passkeys, setPasskeys] = useState([]);
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const [oauthProviders, setOAuthProviders] = useState([]);
  const [linkedAccounts, setLinkedAccounts] = useState([]);
  // Serverweit abschaltbar (TOTP_ENABLED / PASSKEYS_ENABLED)
  const [authMethods, setAuthMethods] = useState({ totp: true, passkeys: true });

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


  const [workLocation, setWorkLocation] =
    useState(null);

  const [savedWorkLocation, setSavedWorkLocation] =
    useState(null);

  const [workQuery, setWorkQuery] =
    useState("");

  const [workCandidates, setWorkCandidates] =
    useState([]);

  const [workSearchLoading, setWorkSearchLoading] =
    useState(false);

  const [workGpsLoading, setWorkGpsLoading] =
    useState(false);

  const [locationRecognitionRadiusMeters, setLocationRecognitionRadiusMeters] =
    useState(250);

  const [savedPlaces, setSavedPlaces] = useState([]);
  const [newPlace, setNewPlace] = useState({ name: "", address: "", latitude: "", longitude: "", radiusMeters: 250, suggestedType: "" });

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
        passkeysResult,
        placesResult,
        oauthProvidersResult,
        linkedAccountsResult,
        authMethodsResult,
      ] = await Promise.all([
        getPersonalSettings(accessToken),
        getDevices(accessToken).catch(() => []),
        getExportCountryOptions(accessToken).catch(() => ({
          countries: [],
          selectedCountry: null,
        })),
        getPasskeys(accessToken).catch(() => []),
        getSavedPlaces(accessToken).catch(() => []),
        getOAuthProviders().catch(() => []),
        getLinkedAccounts(accessToken).catch(() => []),
        getAuthMethods().catch(() => ({ totp: true, passkeys: true })),
      ]);
      setAuthMethods({
        totp: authMethodsResult.totp !== false,
        passkeys: authMethodsResult.passkeys !== false,
      });
      setOAuthProviders(oauthProvidersResult);
      setLinkedAccounts(linkedAccountsResult);
      setSavedPlaces(placesResult);

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

      setPersonalLanguage(settingsResult.settings.language || "");
      setDistanceUnit(settingsResult.settings.distanceUnit === "mi" ? "mi" : "km");
      setDateFormat(settingsResult.settings.dateFormat === "US" ? "US" : "EU");
      setTimeFormat(settingsResult.settings.timeFormat === "12h" ? "12h" : "24h");
      setGravatarEnabled(settingsResult.settings.gravatarEnabled !== false);
      setGravatarAvailable(settingsResult.settings.gravatarAvailable !== false);
      setMonthlyReportEnabled(settingsResult.settings.monthlyReportEnabled !== false);
      setMonthlyReportAvailable(settingsResult.settings.monthlyReportAvailable === true);
      setMapMatchingEnabled(settingsResult.settings.mapMatchingEnabled !== false);
      setMapMatchingAvailable(settingsResult.settings.mapMatchingAvailable === true);
      setSpeedUnit(settingsResult.settings.speedUnit === "mph" ? "mph" : "kmh");

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
        mapRouteColors: settingsResult.settings.mapRouteColors || {},
      });

      setDevices(devicesResult);
      setPasskeys(passkeysResult);

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


      const loadedWorkLocation =
        settingsResult.settings.workLocation ||
        settingsResult.settings.customSettings
          ?.workLocation ||
        null;

      setWorkLocation(loadedWorkLocation);
      setSavedWorkLocation(loadedWorkLocation);
      setWorkQuery(loadedWorkLocation?.address || "");
      setWorkCandidates([]);
      setLocationRecognitionRadiusMeters(
        Number(
          settingsResult.settings.locationRecognitionRadiusMeters ||
            settingsResult.settings.customSettings
              ?.locationRecognitionRadiusMeters ||
            250,
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("profile.page.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [accessToken]);

  // Rückkehr von der Kontoverknüpfung beim Anbieter
  const oauthLinkedParam = searchParams.get("oauthLinked");
  const oauthErrorParam = searchParams.get("oauthError");
  useEffect(() => {
    if (!oauthLinkedParam && !oauthErrorParam) return;

    if (oauthErrorParam) {
      setMessage("");
      setError(t(`oauth.errors.${codeKey(oauthErrorParam)}`, t("oauth.errors.default")));
    } else {
      const name = { google: "Google", microsoft: "Microsoft" }[oauthLinkedParam] || oauthLinkedParam;
      setError("");
      setMessage(t("oauth.linkedSuccess", { provider: name }));
    }

    const next = new URLSearchParams(searchParams);
    next.delete("oauthLinked");
    next.delete("oauthError");
    setSearchParams(next, { replace: true });
  }, [oauthLinkedParam, oauthErrorParam]);

  // Anker erst anspringen, wenn die Abschnitte gerendert sind
  useEffect(() => {
    // z. B. #section-security (OAuth-Rückkehr) oder #section-notifications (Link im Monatsbericht)
    const hash = window.location.hash;
    if (loading || !/^#section-[a-z-]+$/.test(hash)) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [loading]);

  function showSuccess(text) {
    setMessage(text);
    setError("");
  }

  function showError(saveError) {
    setMessage("");
    setError(
      saveError instanceof Error
        ? saveError.message
        : t("profile.page.changeFailed"),
    );
  }

  async function findHomeCandidates() {
    const query = homeQuery.trim();

    if (query.length < 3) {
      setError(
        t("profile.home.tooShort"),
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
          t("profile.location.notFound"),
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
        t("profile.home.required"),
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
      t("profile.home.saved"),
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
        t("profile.home.removed"),
      );
    } catch (deleteError) {
      showError(deleteError);
    } finally {
      setSaving("");
    }
  }

  async function findWorkCandidates() {
    const query = workQuery.trim();

    if (query.length < 3) {
      setError(
        t("profile.work.tooShort"),
      );
      setMessage("");
      return [];
    }

    setWorkSearchLoading(true);
    setError("");
    setMessage("");

    try {
      const result = await searchHomeLocations(
        accessToken,
        query,
      );
      const candidates = result.candidates || [];
      setWorkCandidates(candidates);

      if (candidates.length === 0) {
        setError(t("profile.location.notFound"));
      }

      return candidates;
    } catch (searchError) {
      showError(searchError);
      return [];
    } finally {
      setWorkSearchLoading(false);
    }
  }

  async function persistWorkLocation(candidate) {
    if (!candidate) {
      setError(
        t("profile.work.required"),
      );
      setMessage("");
      return false;
    }

    const result = await saveWorkLocation(
      accessToken,
      candidate,
    );
    const storedLocation = result.workLocation;

    setWorkLocation(storedLocation);
    setSavedWorkLocation(storedLocation);
    setWorkQuery(storedLocation.address);
    setWorkCandidates([]);
    showSuccess(t("profile.work.saved"));
    return true;
  }

  async function saveEnteredWorkLocation() {
    setSaving("work-save");
    setError("");
    setMessage("");

    try {
      const normalizedQuery = workQuery.trim();
      let candidate =
        workLocation &&
        workLocation.address.trim() === normalizedQuery
          ? workLocation
          : null;

      if (!candidate) {
        const candidates = await findWorkCandidates();
        candidate = candidates[0] || null;
      }

      await persistWorkLocation(candidate);
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function removeSavedWorkLocation() {
    setSaving("work-delete");

    try {
      await deleteWorkLocation(accessToken);
      setWorkLocation(null);
      setSavedWorkLocation(null);
      setWorkQuery("");
      setWorkCandidates([]);
      showSuccess(t("profile.work.removed"));
    } catch (deleteError) {
      showError(deleteError);
    } finally {
      setSaving("");
    }
  }

  async function saveRecognitionRadius() {
    setSaving("location-radius");
    setError("");
    setMessage("");

    try {
      const radius = Math.round(
        Number(locationRecognitionRadiusMeters),
      );

      if (!Number.isFinite(radius) || radius < 25 || radius > 5000) {
        setError(t("profile.recognition.range"));
        return;
      }

      const updated = await updatePersonalSettings(
        accessToken,
        { locationRecognitionRadiusMeters: radius },
      );

      setLocationRecognitionRadiusMeters(
        Number(updated.locationRecognitionRadiusMeters || radius),
      );
      showSuccess(t("profile.recognition.saved"));
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function addSavedPlace(event) {
    event.preventDefault();
    setSaving("saved-place");
    try {
      const created = await createSavedPlace(accessToken, {
        ...newPlace,
        latitude: Number(newPlace.latitude),
        longitude: Number(newPlace.longitude),
        radiusMeters: Number(newPlace.radiusMeters),
        suggestedType: newPlace.suggestedType || null,
      });
      setSavedPlaces((items) => [...items, created]);
      setNewPlace({ name: "", address: "", latitude: "", longitude: "", radiusMeters: locationRecognitionRadiusMeters, suggestedType: "" });
      showSuccess(t("profile.places.saved"));
    } catch (e) { showError(e); } finally { setSaving(""); }
  }

  async function removeSavedPlace(id) {
    try {
      await deleteSavedPlace(accessToken, id);
      setSavedPlaces((items) => items.filter((p) => p.id !== id));
      showSuccess(t("profile.places.removed"));
    } catch (e) { showError(e); }
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
      showSuccess(t("profile.account.saved"));
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
        t("profile.country.saved"),
      );
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function saveLanguage(event) {
    event.preventDefault(); setSaving("language");
    try {
      await updatePersonalSettings(accessToken,{language:personalLanguage || null});
      showSuccess(t("profile.language.saved"));
      window.location.reload();
    } catch(saveError){showError(saveError);} finally{setSaving("");}
  }

  async function saveSpeedUnit(event) {
    event.preventDefault();
    setSaving("speed-unit");
    try {
      const updated = await updatePersonalSettings(accessToken, { speedUnit });
      setSpeedUnit(updated.speedUnit === "mph" ? "mph" : "kmh");
      showSuccess(t("profile.speed.saved"));
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function saveTimeFormat(event) {
    event.preventDefault();
    setSaving("time-format");
    try {
      const updated = await updatePersonalSettings(accessToken, { timeFormat });
      setTimeFormat(updated.timeFormat === "12h" ? "12h" : "24h");
      showSuccess(t("profile.time.saved"));
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function saveMapMatching(event) {
    event.preventDefault();
    setSaving("map-matching");
    try {
      const updated = await updatePersonalSettings(accessToken, { mapMatchingEnabled });
      setMapMatchingEnabled(updated.mapMatchingEnabled !== false);
      setMapMatchingAvailable(updated.mapMatchingAvailable === true);
      showSuccess(t("profile.mapMatching.saved"));
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function saveMonthlyReport(event) {
    event.preventDefault();
    setSaving("monthly-report");
    try {
      const updated = await updatePersonalSettings(accessToken, { monthlyReportEnabled });
      setMonthlyReportEnabled(updated.monthlyReportEnabled !== false);
      showSuccess(t("profile.monthlyReport.saved"));
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function sendMonthlyReportNow() {
    setSaving("monthly-report-send");
    try {
      const result = await sendMonthlyReport(accessToken);
      showSuccess(t("profile.monthlyReport.sent", { email: result.to || "" }));
    } catch (sendError) {
      showError(sendError);
    } finally {
      setSaving("");
    }
  }

  async function saveGravatar(event) {
    event.preventDefault();
    setSaving("gravatar");
    try {
      const updated = await updatePersonalSettings(accessToken, { gravatarEnabled });
      setGravatarEnabled(updated.gravatarEnabled !== false);
      // Kopfzeile sofort aktualisieren
      window.dispatchEvent(new CustomEvent(GRAVATAR_SETTING_EVENT, {
        detail: updated.gravatarEnabled !== false && updated.gravatarAvailable !== false,
      }));
      showSuccess(t("profile.gravatar.saved"));
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function saveDateFormat(event) {
    event.preventDefault();
    setSaving("date-format");
    try {
      const updated = await updatePersonalSettings(accessToken, { dateFormat });
      setDateFormat(updated.dateFormat === "US" ? "US" : "EU");
      showSuccess(t("profile.date.saved"));
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function saveDistanceUnit(event) {
    event.preventDefault();
    setSaving("distance-unit");
    try {
      const updated = await updatePersonalSettings(accessToken, { distanceUnit });
      setDistanceUnit(updated.distanceUnit === "mi" ? "mi" : "km");
      showSuccess(t("profile.distance.saved"));
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
        mapRouteColors: updated.mapRouteColors || {},
      });

      showSuccess(
        t("profile.tracking.saved"),
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
        t("profile.password.mismatch"),
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

      showSuccess(t("profile.password.changed"));
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

      showSuccess(t("profile.devices.signedOutMessage"));
    } catch (saveError) {
      showError(saveError);
    } finally {
      setSaving("");
    }
  }

  async function addPasskey() {
    setSaving("passkey-add");
    setError("");
    setMessage("");
    try {
      const options = await getPasskeyRegistrationOptions(accessToken);
      const credential = await createPasskey(options);
      await verifyPasskeyRegistration(
        accessToken,
        credential,
        newPasskeyName.trim() || t("profile.passkeys.defaultName"),
      );
      setPasskeys(await getPasskeys(accessToken));
      setNewPasskeyName("");
      showSuccess(t("profile.passkeys.registered"));
    } catch (passkeyError) {
      if (passkeyError?.name !== "NotAllowedError") showError(passkeyError);
    } finally {
      setSaving("");
    }
  }

  async function editPasskey(passkey) {
    const name = window.prompt(t("profile.passkeys.namePrompt"), passkey.name);
    if (!name?.trim() || name.trim() === passkey.name) return;
    setSaving(`passkey-rename:${passkey.id}`);
    try {
      const updated = await renamePasskey(accessToken, passkey.id, name.trim());
      setPasskeys((current) =>
        current.map((item) => item.id === passkey.id ? updated : item),
      );
      showSuccess(t("profile.passkeys.renamed"));
    } catch (passkeyError) {
      showError(passkeyError);
    } finally {
      setSaving("");
    }
  }

  async function removePasskey(passkey) {
    if (!window.confirm(t("profile.passkeys.deleteConfirm", { name: passkey.name }))) return;
    setSaving(`passkey-delete:${passkey.id}`);
    try {
      await deletePasskey(accessToken, passkey.id);
      setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
      showSuccess(t("profile.passkeys.deleted"));
    } catch (passkeyError) {
      showError(passkeyError);
    } finally {
      setSaving("");
    }
  }

  async function linkAccount(provider) {
    setSaving(`oauth-link:${provider.id}`);
    setError("");

    try {
      const { authorizationUrl } = await startAccountLink(accessToken, provider.id);
      window.location.assign(authorizationUrl);
    } catch (linkError) {
      setMessage("");
      setError(
        linkError?.code
          ? t(`oauth.errors.${codeKey(linkError.code)}`, linkError.message || t("oauth.errors.default"))
          : t("oauth.errors.default"),
      );
      setSaving("");
    }
  }

  async function removeLinkedAccount(account, providerName) {
    if (!window.confirm(t("oauth.unlinkConfirm", {
      provider: providerName,
      account: account.email || account.displayName || "–",
    }))) return;

    setSaving(`oauth-unlink:${account.id}`);

    try {
      await unlinkAccount(accessToken, account.id);
      setLinkedAccounts((current) => current.filter((item) => item.id !== account.id));
      showSuccess(t("oauth.unlinkedSuccess"));
    } catch (unlinkError) {
      setMessage("");
      setError(
        unlinkError?.code
          ? t(`oauth.errors.${codeKey(unlinkError.code)}`, unlinkError.message || t("oauth.errors.default"))
          : t("oauth.errors.default"),
      );
    } finally {
      setSaving("");
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">
        {t("profile.page.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t("profile.page.eyebrow")}
        title={t("profile.page.headerTitle")}
        subtitle={t("profile.page.subtitle")}
      />

      <nav
        aria-label={t("profile.page.heading")}
        className="flex gap-7 overflow-x-auto border-b border-fb-border"
      >
        <TabButton
          active={activeTab === "settings"}
          onClick={() =>
            openTab("settings")
          }
        >
          {t("profile.page.heading")}
        </TabButton>

        <TabButton
          active={activeTab === "units"}
          onClick={() => openTab("units")}
        >
          {t("profile.units.title")}
        </TabButton>

        <TabButton
          active={activeTab === "backup"}
          onClick={() =>
            openTab("backup")
          }
        >
          {t("profile.backup.tab")}
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

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav aria-label={t("profile.page.sectionsAria")} className="mb-6 hidden lg:sticky lg:top-6 lg:mb-0 lg:block">
          <ul className="space-y-0.5 text-sm">
            {SETTINGS_GROUPS.map(([id, title]) => (
              <li key={id}>
                <a
                  href={`#section-${id}`}
                  aria-current={activeGroup === id ? "true" : undefined}
                  className={`block rounded-lg px-3 py-2.5 transition ${activeGroup === id ? "bg-fb-accent-soft font-semibold text-fb-accent-strong" : "text-fb-muted hover:bg-fb-main hover:text-fb-text"}`}
                >
                  {t(title)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5">
      <form onSubmit={saveProfile}>
        <Section
          id="profile"
          title={t("profile.nav.profile")}
          description={t("profile.account.description")}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <label className={labelClass}>
              {t("profile.account.displayName")}
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
              {t("profile.account.username")}
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
              {t("profile.account.email")}
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
              {t("profile.language.title")}
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
                <option value="de">{t("profile.language.german")}</option>
                <option value="en">English</option>
              </select>
            </label>

            <label className={labelClass}>
              {t("profile.account.timezone")}
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
              {t("profile.account.theme")}
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
                  {t("profile.account.themeSystem")}
                </option>
                <option value="light">{t("profile.account.themeLight")}</option>
                <option value="dark">{t("profile.account.themeDark")}</option>
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
                ? t("profile.page.saving")
                : t("profile.account.save")}
            </button>
          </div>
        </Section>
      </form>

      <form onSubmit={saveLanguage}>
        <Section id="language" title={t("profile.language.title")} description={t("profile.language.description")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className={labelClass}>{t("profile.language.label")}
              <select value={personalLanguage} onChange={(e)=>setPersonalLanguage(e.target.value)} className={fieldClass}>
                <option value="">{t("profile.language.systemDefault")}</option><option value="de">{t("profile.language.german")}</option><option value="en">English</option>
              </select>
            </label>
            <button disabled={saving==="language"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-50">{t("profile.language.save")}</button>
          </div>
        </Section>
      </form>

      <form onSubmit={saveHomeCountry}>
        <Section
          id="country"
          title={t("profile.country.title")}
          description={t("profile.country.description")}
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className={labelClass}>
              {t("profile.country.label")}
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
                {t("profile.country.activeProfile")}
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
                      {t("profile.country.loading")}
                    </p>
                  );
                }

                return (
                  <>
                    <p className="mt-2 text-sm text-fb-text">
                      {selected.reportTitle}
                    </p>

                    <p className="mt-1 text-xs text-fb-muted">
                      {t("profile.country.period", { value: selected.taxYearLabel })}
                      {" · "}
                      {t("profile.country.unit", { value: selected.distanceUnit })}
                      {" · "}
                      {t("profile.country.currency", { value: selected.currency })}
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
                ? t("profile.page.saving")
                : t("profile.country.save")}
            </button>
          </div>
        </Section>
      </form>

      <Section
        id="home"
        title={t("profile.home.title")}
        description={t("profile.home.description")}
      >
        {savedHomeLocation && (
          <div className="mb-5 rounded-lg border border-fb-border bg-fb-surface p-4">
            <div className="text-sm font-semibold">
              {t("profile.location.current")}
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
                ? t("profile.location.sourceGps")
                : t("profile.location.sourceManual")}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className={labelClass}>
            {t("profile.location.query")}
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
              placeholder={t("profile.home.placeholder")}
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
              ? t("profile.location.searching")
              : t("profile.location.search")}
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
                      t("profile.home.addressSelected"),
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
                {t("profile.location.selected")}
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
                  t("profile.location.noGeolocation"),
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
                      t("profile.home.gpsFound"),
                    );
                  } catch (gpsError) {
                    showError(gpsError);
                  } finally {
                    setGpsLoading(false);
                  }
                },
                (gpsError) => {
                  const messages = {
                    1: t("profile.location.gpsDenied"),
                    2: t("profile.location.gpsUnavailable"),
                    3: t("profile.location.gpsTimeout"),
                  };

                  setError(
                    messages[gpsError.code] ||
                      t("profile.location.gpsUnavailable"),
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
              ? t("profile.location.locating")
              : t("profile.location.useCurrent")}
          </button>

          {!window.isSecureContext && (
            <p className="text-xs text-fb-danger">
              {t("profile.location.httpsHint")}
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
                ? t("profile.page.removing")
                : t("profile.home.remove")}
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
              ? t("profile.page.saving")
              : t("profile.home.save")}
          </button>
        </div>
      </Section>

      <Section
        id="work"
        title={t("profile.work.title")}
        description={t("profile.work.description")}
      >
        {savedWorkLocation && (
          <div className="mb-5 rounded-lg border border-fb-border bg-fb-surface p-4">
            <div className="text-sm font-semibold">{t("profile.location.current")}</div>
            <div className="mt-1 text-sm text-fb-text">
              {savedWorkLocation.address}
            </div>
            <div className="mt-1 text-xs text-fb-muted">
              {Number(savedWorkLocation.latitude).toFixed(6)}, {" "}
              {Number(savedWorkLocation.longitude).toFixed(6)}
              {" · "}
              {savedWorkLocation.source === "gps"
                ? t("profile.location.sourceGps")
                : t("profile.location.sourceManual")}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className={labelClass}>
            {t("profile.location.query")}
            <input
              type="text"
              value={workQuery}
              onChange={(event) => {
                const value = event.target.value;
                setWorkQuery(value);
                setWorkCandidates([]);
                if (workLocation?.address !== value.trim()) {
                  setWorkLocation(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveEnteredWorkLocation();
                }
              }}
              placeholder={t("profile.work.placeholder")}
              className={fieldClass}
            />
          </label>

          <button
            type="button"
            disabled={workSearchLoading || workQuery.trim().length < 3}
            onClick={findWorkCandidates}
            className="self-end rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent disabled:opacity-60"
          >
            {workSearchLoading ? t("profile.location.searching") : t("profile.location.search")}
          </button>
        </div>

        {workCandidates.length > 0 && (
          <div className="mt-4 divide-y divide-fb-border overflow-hidden rounded-lg border border-fb-border">
            {workCandidates.map((candidate, index) => (
              <button
                key={`${candidate.latitude}-${candidate.longitude}-${index}`}
                type="button"
                onClick={() => {
                  setWorkLocation(candidate);
                  setWorkQuery(candidate.address);
                  setWorkCandidates([]);
                  setError("");
                  setMessage(
                    t("profile.work.addressSelected"),
                  );
                }}
                className="block w-full bg-fb-main px-4 py-3 text-left transition hover:bg-fb-surface"
              >
                <div className="text-sm font-medium">{candidate.address}</div>
                <div className="mt-1 text-xs text-fb-muted">
                  {Number(candidate.latitude).toFixed(6)}, {" "}
                  {Number(candidate.longitude).toFixed(6)}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={workGpsLoading}
            onClick={() => {
              if (!navigator.geolocation) {
                setError(t("profile.location.noGeolocation"));
                return;
              }

              setWorkGpsLoading(true);
              setError("");
              setMessage("");

              navigator.geolocation.getCurrentPosition(
                async (position) => {
                  try {
                    const result = await reverseHomeLocation(
                      accessToken,
                      {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                      },
                    );
                    setWorkLocation(result.candidate);
                    setWorkQuery(result.candidate.address);
                    setWorkCandidates([]);
                    setMessage(
                      t("profile.work.gpsFound"),
                    );
                  } catch (gpsError) {
                    showError(gpsError);
                  } finally {
                    setWorkGpsLoading(false);
                  }
                },
                () => {
                  setError(t("profile.location.gpsUnavailable"));
                  setWorkGpsLoading(false);
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
            {workGpsLoading
              ? t("profile.location.locating")
              : t("profile.location.useCurrent")}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {savedWorkLocation && (
            <button
              type="button"
              disabled={saving === "work-delete" || saving === "work-save"}
              onClick={removeSavedWorkLocation}
              className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-danger transition hover:border-fb-danger disabled:opacity-60"
            >
              {saving === "work-delete" ? t("profile.page.removing") : t("profile.work.remove")}
            </button>
          )}

          <button
            type="button"
            disabled={
              workQuery.trim().length < 3 ||
              workSearchLoading ||
              saving === "work-save" ||
              saving === "work-delete"
            }
            onClick={saveEnteredWorkLocation}
            className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
          >
            {saving === "work-save" ? t("profile.page.saving") : t("profile.work.save")}
          </button>
        </div>
      </Section>

      <Section
        id="recognition"
        title={t("profile.recognition.title")}
        description={t("profile.recognition.description")}
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-end">
          <label className={labelClass}>
            {t("profile.recognition.radius")}
            <input
              type="number"
              min="25"
              max="5000"
              step="25"
              value={locationRecognitionRadiusMeters}
              onChange={(event) =>
                setLocationRecognitionRadiusMeters(event.target.value)
              }
              className={fieldClass}
            />
          </label>

          <div className="text-sm text-fb-muted">
            {t("profile.recognition.hint")}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            disabled={saving === "location-radius"}
            onClick={saveRecognitionRadius}
            className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
          >
            {saving === "location-radius" ? t("profile.page.saving") : t("profile.recognition.save")}
          </button>
        </div>
      </Section>

      <Section
        id="places"
        title={t("profile.places.title")}
        description={t("profile.places.description")}
      >
        <form onSubmit={addSavedPlace} className="grid gap-3 md:grid-cols-3">
          <input required placeholder={t("profile.places.namePlaceholder")} value={newPlace.name} onChange={(e)=>setNewPlace(p=>({...p,name:e.target.value}))} className={fieldClass} />
          <input placeholder={t("profile.places.address")} value={newPlace.address} onChange={(e)=>setNewPlace(p=>({...p,address:e.target.value}))} className={fieldClass} />
          <select value={newPlace.suggestedType} onChange={(e)=>setNewPlace(p=>({...p,suggestedType:e.target.value}))} className={fieldClass}>
            <option value="">{t("profile.tracking.noCategory")}</option><option value="business">{t("profile.tracking.business")}</option><option value="private">{t("profile.tracking.private")}</option><option value="commute">{t("profile.tracking.commute")}</option>
          </select>
          <input required type="number" step="any" placeholder={t("profile.places.latitude")} value={newPlace.latitude} onChange={(e)=>setNewPlace(p=>({...p,latitude:e.target.value}))} className={fieldClass} />
          <input required type="number" step="any" placeholder={t("profile.places.longitude")} value={newPlace.longitude} onChange={(e)=>setNewPlace(p=>({...p,longitude:e.target.value}))} className={fieldClass} />
          <div className="flex gap-2"><input required type="number" min="25" max="5000" value={newPlace.radiusMeters} onChange={(e)=>setNewPlace(p=>({...p,radiusMeters:e.target.value}))} className={fieldClass} /><button disabled={saving==="saved-place"} className="mt-2 rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text">{t("profile.page.save")}</button></div>
        </form>
        <div className="mt-5 divide-y divide-fb-border">
          {savedPlaces.map((place)=>(
            <div key={place.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div><div className="font-semibold">{place.name}</div><div className="text-fb-muted">{place.address || `${place.latitude}, ${place.longitude}`} · {place.radiusMeters || locationRecognitionRadiusMeters} m</div></div>
              <button type="button" onClick={()=>removeSavedPlace(place.id)} className="rounded border border-fb-border px-3 py-1.5 text-xs">{t("profile.page.remove")}</button>
            </div>
          ))}
        </div>
      </Section>

      <form onSubmit={saveTracking}>
        <Section
          id="tracking"
          title={t("profile.tracking.title")}
          description={t("profile.tracking.description")}
        >
          <div className="space-y-5">
            <label className="flex items-start justify-between gap-6 rounded-lg border border-fb-border bg-fb-surface p-4">
              <span>
                <span className="block text-sm font-semibold">
                  {t("profile.tracking.auto")}
                </span>
                <span className="mt-1 block text-sm text-fb-muted">
                  {t("profile.tracking.autoHint")}
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
                {t("profile.tracking.accuracyMode")}
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
                    {t("profile.tracking.accuracyHigh")}
                  </option>
                  <option value="balanced">
                    {t("profile.tracking.accuracyBalanced")}
                  </option>
                  <option value="battery">
                    {t("profile.tracking.accuracyLow")}
                  </option>
                </select>
              </label>

              <label className={labelClass}>
                {t("profile.tracking.stopDelay")}
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
                {t("profile.tracking.mapProvider")}
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
                    {t("profile.tracking.mapAtlas")}
                  </option>
                </select>
        </label>
              <div className="mt-5">
                <h3 className="text-sm font-semibold">{t("profile.tracking.routeColors")}</h3>
                <p className="mt-1 text-xs text-fb-muted">{t("profile.tracking.routeColorsHint")}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[
                    ["private", t("profile.tracking.private")],
                    ["business", t("profile.tracking.business")],
                    ["commute", t("profile.tracking.commute")],
                    ["unclassified", t("profile.tracking.unclassified")],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-3 rounded-lg border border-fb-border p-3 text-sm">
                      <input type="checkbox" checked={Boolean(tracking.mapRouteColors?.[key])}
                        onChange={(event) => setTracking((current) => ({
                          ...current, mapRouteColors: { ...current.mapRouteColors, [key]: event.target.checked ? DEFAULT_ROUTE_COLORS[key] : null },
                        }))} />
                      <span className="flex-1">{label}</span>
                      <input type="color" aria-label={t("profile.tracking.colorFor", { label })} disabled={!tracking.mapRouteColors?.[key]}
                        value={tracking.mapRouteColors?.[key] || DEFAULT_ROUTE_COLORS[key]}
                        onChange={(event) => setTracking((current) => ({
                          ...current, mapRouteColors: { ...current.mapRouteColors, [key]: event.target.value },
                        }))} className="h-9 w-12 cursor-pointer rounded border border-fb-border" />
                    </label>
                  ))}
                </div>
              </div>

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
                  {t("profile.tracking.storeAccuracy")}
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
                ? t("profile.page.saving")
                : t("profile.tracking.save")}
            </button>
          </div>
        </Section>
      </form>

      <form onSubmit={saveMapMatching}>
        <Section id="mapMatching" title={t("profile.mapMatching.title")} description={t("profile.mapMatching.description")}>
          <label className={labelClass} htmlFor="profile-map-matching">{t("profile.mapMatching.label")}</label>
          <select
            id="profile-map-matching"
            className={fieldClass}
            value={mapMatchingEnabled ? "on" : "off"}
            disabled={!mapMatchingAvailable}
            aria-describedby="profile-map-matching-hint"
            onChange={(event) => setMapMatchingEnabled(event.target.value === "on")}
          >
            <option value="on">{t("profile.mapMatching.on")}</option>
            <option value="off">{t("profile.mapMatching.off")}</option>
          </select>
          <p id="profile-map-matching-hint" className="mt-2 text-sm text-fb-muted">
            {mapMatchingAvailable ? t("profile.mapMatching.hint") : t("profile.mapMatching.unavailable")}
          </p>
          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={!mapMatchingAvailable || saving === "map-matching"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "map-matching" ? t("common.saving") : t("common.save")}</button>
          </div>
        </Section>
      </form>

      <DawarichConnectionSection accessToken={accessToken} onSuccess={showSuccess} onError={showError} />

      <form onSubmit={saveMonthlyReport}>
        <Section id="notifications" title={t("profile.monthlyReport.title")} description={t("profile.monthlyReport.description")}>
          <label className={labelClass} htmlFor="profile-monthly-report">{t("profile.monthlyReport.label")}</label>
          <select
            id="profile-monthly-report"
            className={fieldClass}
            value={monthlyReportEnabled ? "on" : "off"}
            disabled={!monthlyReportAvailable}
            onChange={(event) => setMonthlyReportEnabled(event.target.value === "on")}
          >
            <option value="on">{t("profile.monthlyReport.on")}</option>
            <option value="off">{t("profile.monthlyReport.off")}</option>
          </select>
          {!monthlyReportAvailable && <p className="mt-2 text-sm text-fb-muted">{t("profile.monthlyReport.unavailable")}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Link to="/reports/monthly" className="inline-flex items-center rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold hover:border-fb-accent">{t("profile.monthlyReport.view")}</Link>
            {monthlyReportAvailable && features.monthlyReportSendNow && (
              <button type="button" onClick={sendMonthlyReportNow} disabled={saving === "monthly-report-send"} className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold hover:border-fb-accent disabled:opacity-60">
                {saving === "monthly-report-send" ? t("profile.monthlyReport.sending") : t("profile.monthlyReport.sendNow")} <span className="ml-1 rounded-full bg-fb-warn-soft px-2 py-0.5 text-xs font-semibold text-fb-warn">dev</span>
              </button>
            )}
            <button type="submit" disabled={!monthlyReportAvailable || saving === "monthly-report"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "monthly-report" ? t("common.saving") : t("common.save")}</button>
          </div>
        </Section>
      </form>

      <form onSubmit={savePassword}>
        <Section
          id="credentials"
          title={t("profile.password.title")}
          description={t("profile.password.description")}
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <label className={labelClass}>
              {t("profile.password.current")}
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
              {t("profile.password.new")}
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
              {t("profile.password.confirm")}
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
                ? t("profile.password.changing")
                : t("profile.password.change")}
            </button>
          </div>
        </Section>
      </form>

      <Section
        id="security"
        title={t("profile.nav.security")}
        description={t("profile.security.description")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-fb-border bg-fb-surface p-4">
            <div className="font-semibold">
              {t("profile.security.totp")}
            </div>
            <div className="mt-1 text-sm text-fb-muted">
              {!authMethods.totp
                ? t("authMethods.totpDisabled")
                : user?.totpEnabled
                  ? t("profile.security.enabled")
                  : t("profile.security.notEnabled")}
            </div>
          </div>

          {!authMethods.passkeys ? (
          <div className="rounded-lg border border-fb-border bg-fb-surface p-4 sm:col-span-2">
            <div className="font-semibold">{t("profile.passkeys.title")}</div>
            <p className="mt-1 text-sm text-fb-muted">{t("authMethods.passkeysDisabled")}</p>
          </div>
          ) : (
          <div className="rounded-lg border border-fb-border bg-fb-surface p-4 sm:col-span-2">
            <div className="font-semibold">{t("profile.passkeys.title")}</div>
            <p className="mt-1 text-sm text-fb-muted">
              {t("profile.passkeys.hint")}
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={newPasskeyName}
                onChange={(event) => setNewPasskeyName(event.target.value)}
                placeholder={t("profile.passkeys.namePlaceholder")}
                maxLength={120}
                className={fieldClass}
              />
              <button
                type="button"
                onClick={addPasskey}
                disabled={saving === "passkey-add" || user?.passkeyEnabled === false}
                className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60"
              >
                {saving === "passkey-add" ? t("profile.passkeys.registering") : t("profile.passkeys.add")}
              </button>
            </div>

            {user?.passkeyEnabled === false && (
              <p className="mt-3 text-sm text-fb-danger">
                {t("profile.passkeys.disabledByAdmin")}
              </p>
            )}

            <div className="mt-4 divide-y divide-fb-border rounded-lg border border-fb-border">
              {passkeys.length === 0 ? (
                <p className="p-4 text-sm text-fb-muted">{t("profile.passkeys.none")}</p>
              ) : passkeys.map((passkey) => (
                <div key={passkey.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold">{passkey.name}</div>
                    <div className="mt-1 text-xs text-fb-muted">
                      {t("profile.passkeys.created", { date: new Date(passkey.createdAt).toLocaleString(locale) })}
                      {passkey.lastUsedAt ? ` · ${t("profile.passkeys.lastUsed", { date: new Date(passkey.lastUsedAt).toLocaleString(locale) })}` : ""}
                      {passkey.backedUp ? ` · ${t("profile.passkeys.synced")}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => editPasskey(passkey)} className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-accent">
                      {t("profile.passkeys.rename")}
                    </button>
                    <button type="button" onClick={() => removePasskey(passkey)} className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold text-fb-danger hover:border-fb-danger">
                      {t("profile.passkeys.delete")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          <div className="rounded-lg border border-fb-border bg-fb-surface p-4 sm:col-span-2">
            <div className="font-semibold">{t("oauth.linkedTitle")}</div>
            <p className="mt-1 text-sm text-fb-muted">{t("oauth.linkedHint")}</p>

            {oauthProviders.some((provider) => provider.enabled) || linkedAccounts.length > 0 ? (
              <div className="mt-4 divide-y divide-fb-border rounded-lg border border-fb-border">
                {oauthProviders
                  .filter((provider) =>
                    provider.enabled || linkedAccounts.some((account) => account.provider === provider.id))
                  .map((provider) => {
                    const account = linkedAccounts.find((item) => item.provider === provider.id);

                    return (
                      <div key={provider.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-semibold">{provider.name}</div>
                          <div className="mt-1 text-xs text-fb-muted">
                            {account ? (
                              <>
                                {account.email || account.displayName}
                                {" · "}
                                {t("oauth.linkedSince", { date: formatSafeDate(account.createdAt) })}
                                {account.lastUsedAt
                                  ? ` · ${t("oauth.lastUsed", { date: formatSafeDate(account.lastUsedAt) })}`
                                  : ""}
                              </>
                            ) : t("oauth.notLinked")}
                          </div>
                        </div>
                        {account ? (
                          <button
                            type="button"
                            onClick={() => removeLinkedAccount(account, provider.name)}
                            disabled={saving === `oauth-unlink:${account.id}`}
                            className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold text-fb-danger hover:border-fb-danger disabled:opacity-60"
                          >
                            {t("oauth.unlink")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => linkAccount(provider)}
                            disabled={Boolean(saving)}
                            className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60"
                          >
                            {saving === `oauth-link:${provider.id}`
                              ? t("oauth.linking")
                              : t("oauth.link", { provider: provider.name })}
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="mt-3 text-sm text-fb-muted">{t("oauth.notConfigured")}</p>
            )}
          </div>
        </div>
      </Section>

      <Section
        id="devices"
        title={t("profile.devices.title")}
        description={t("profile.devices.description")}
      >
        <div className="mb-5 flex justify-end">
          <button
            type="button"
            onClick={() =>
              setAddDeviceModalOpen(true)
            }
            className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent"
          >
            {t("profile.devices.add")}
          </button>
        </div>

        <div className="divide-y divide-fb-border">
          {devices.length === 0 ? (
            <div className="py-6 text-sm text-fb-muted">
              {t("profile.devices.none")}
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
                        {t("profile.devices.current")}
                      </span>
                    )}

                    {device.revokedAt && (
                      <span className="rounded-full border border-fb-border px-2 py-0.5 text-xs text-fb-muted">
                        {t("profile.devices.signedOut")}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-sm text-fb-muted">
                    {device.platform || device.deviceType}
                    {device.lastSeenAt ? ` · zuletzt ${formatSafeDate(device.lastSeenAt)}` : ""}
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
                        ? t("profile.devices.signingOut")
                        : t("profile.devices.signOut")}
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
            t("profile.pairing.success"),
          );
        }}
      />
        </div>
      </div>
        </>
      ) : activeTab === "units" ? (
        <>
          <header className="space-y-1">
            <h2 className="text-xl font-semibold">{t("profile.units.title")}</h2>
            <p className="text-sm text-fb-muted">{t("profile.units.description")}</p>
          </header>
          {message && <div className="rounded-xl border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent">{message}</div>}
          {error && <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>}
      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
      <form onSubmit={saveSpeedUnit} className="h-full">
        <Section title={t("profile.speed.title")} description={t("profile.speed.description")}>
          <label className={labelClass} htmlFor="profile-speed-unit">{t("profile.speed.label")}</label>
          <select id="profile-speed-unit" className={fieldClass} value={speedUnit} onChange={(event) => setSpeedUnit(event.target.value)}>
            <option value="kmh">{t("profile.speed.kmh")}</option>
            <option value="mph">{t("profile.speed.mph")}</option>
          </select>
          <div className="mt-6 flex justify-end"><button type="submit" disabled={saving === "speed-unit"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "speed-unit" ? t("profile.speed.saving") : t("profile.speed.save")}</button></div>
        </Section>
      </form>

      <form onSubmit={saveTimeFormat} className="h-full">
        <Section title={t("profile.time.title")} description={t("profile.time.description")}>
          <label className={labelClass} htmlFor="profile-time-format">{t("profile.time.label")}</label>
          <select id="profile-time-format" className={fieldClass} value={timeFormat} onChange={(event) => setTimeFormat(event.target.value)}>
            <option value="24h">{t("profile.time.hours24")}</option>
            <option value="12h">{t("profile.time.hours12")}</option>
          </select>
          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={saving === "time-format"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">
              {saving === "time-format" ? t("profile.time.saving") : t("profile.time.save")}
            </button>
          </div>
        </Section>
      </form>

      <form onSubmit={saveDateFormat} className="h-full">
        <Section title={t("profile.date.title")} description={t("profile.date.description")}>
          <label className={labelClass} htmlFor="profile-date-format">{t("profile.date.label")}</label>
          <select id="profile-date-format" className={fieldClass} value={dateFormat} onChange={(event) => setDateFormat(event.target.value)}>
            <option value="EU">{t("profile.date.eu")}</option>
            <option value="US">{t("profile.date.us")}</option>
          </select>
          <div className="mt-6 flex justify-end"><button type="submit" disabled={saving === "date-format"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "date-format" ? t("profile.date.saving") : t("profile.date.save")}</button></div>
        </Section>
      </form>

      <form onSubmit={saveDistanceUnit} className="h-full">
        <Section title={t("profile.distance.title")} description={t("profile.distance.description")}>
          <label className={labelClass} htmlFor="profile-distance-unit">{t("profile.distance.label")}</label>
          <select id="profile-distance-unit" className={fieldClass} value={distanceUnit} onChange={(event) => setDistanceUnit(event.target.value)}>
            <option value="km">{t("profile.distance.km")}</option>
            <option value="mi">{t("profile.distance.mi")}</option>
          </select>
          <div className="mt-6 flex justify-end"><button type="submit" disabled={saving === "distance-unit"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "distance-unit" ? t("profile.distance.saving") : t("profile.distance.save")}</button></div>
        </Section>
      </form>

      <form onSubmit={saveGravatar} className="h-full">
        <Section title={t("profile.gravatar.title")} description={t("profile.gravatar.description")}>
          <label className={labelClass} htmlFor="profile-gravatar">{t("profile.gravatar.label")}</label>
          <select
            id="profile-gravatar"
            className={fieldClass}
            value={gravatarEnabled ? "on" : "off"}
            disabled={!gravatarAvailable}
            onChange={(event) => setGravatarEnabled(event.target.value === "on")}
          >
            <option value="on">{t("profile.gravatar.on")}</option>
            <option value="off">{t("profile.gravatar.off")}</option>
          </select>
          {!gravatarAvailable && <p className="mt-2 text-sm text-fb-muted">{t("profile.gravatar.disabledByAdmin")}</p>}
          <div className="mt-6 flex justify-end"><button type="submit" disabled={!gravatarAvailable || saving === "gravatar"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "gravatar" ? t("profile.gravatar.saving") : t("profile.gravatar.save")}</button></div>
        </Section>
      </form>

      </div>
        </>
      ) : (
        <UserDataTransfer />
      )}
    </div>
  );
}
