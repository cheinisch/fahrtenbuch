import { useI18n } from "../i18n/I18nProvider.jsx";
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
import { DEFAULT_ROUTE_COLORS } from "../lib/routeColors.js";
import PageHeader from "../components/PageHeader.jsx";
import { GRAVATAR_SETTING_EVENT } from "../lib/gravatar.js";

// Gruppen der Abschnittsnavigation (wie im Mockup); der Anker zeigt auf den
// ersten Abschnitt der Gruppe, SECTION_GROUP ordnet jeden Abschnitt zu.
const SETTINGS_GROUPS = [
  ["profile", "profileTranslations.groupProfile"],
  ["home", "profileTranslations.groupPlaces"],
  ["tracking", "profileTranslations.groupTracking"],
  ["credentials", "profileTranslations.groupSecurity"],
  ["devices", "profileTranslations.groupDevices"],
];

const SECTION_GROUP = {
  profile: "profile", language: "profile", country: "profile",
  home: "home", work: "home", recognition: "home", places: "home",
  tracking: "tracking",
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
          : t("profileTranslations.loadFailed"),
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
      setError(t(`oauth.errors.${oauthErrorParam}`, t("oauth.errors.default")));
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
    if (loading || window.location.hash !== "#section-security") return;
    document.getElementById("section-security")?.scrollIntoView({ block: "start" });
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
        : t("profileTranslations.67"),
    );
  }

  async function findHomeCandidates() {
    const query = homeQuery.trim();

    if (query.length < 3) {
      setError(
        t("profileTranslations.91"),
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
          t("profileTranslations.68"),
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
        t("profileTranslations.93"),
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
      t("profileTranslations.84"),
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
        t("profileTranslations.85"),
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
        t("profileTranslations.92"),
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
        setError(t("profileTranslations.68"));
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
        t("profileTranslations.94"),
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
    showSuccess(t("profileTranslations.86"));
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
      showSuccess(t("profileTranslations.87"));
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
        setError(t("profileTranslations.radiusRange"));
        return;
      }

      const updated = await updatePersonalSettings(
        accessToken,
        { locationRecognitionRadiusMeters: radius },
      );

      setLocationRecognitionRadiusMeters(
        Number(updated.locationRecognitionRadiusMeters || radius),
      );
      showSuccess(t("profileTranslations.88"));
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
      showSuccess(t("profileTranslations.80"));
    } catch (e) { showError(e); } finally { setSaving(""); }
  }

  async function removeSavedPlace(id) {
    try {
      await deleteSavedPlace(accessToken, id);
      setSavedPlaces((items) => items.filter((p) => p.id !== id));
      showSuccess(t("profileTranslations.81"));
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
      showSuccess(t("profileTranslations.82"));
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
        t("profileTranslations.89"),
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
      showSuccess(t("profileTranslations.90"));
      window.location.reload();
    } catch(saveError){showError(saveError);} finally{setSaving("");}
  }

  async function saveSpeedUnit(event) {
    event.preventDefault();
    setSaving("speed-unit");
    try {
      const updated = await updatePersonalSettings(accessToken, { speedUnit });
      setSpeedUnit(updated.speedUnit === "mph" ? "mph" : "kmh");
      showSuccess(t("speedPreference.saved"));
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
      showSuccess(t("timePreference.saved"));
    } catch (saveError) {
      showError(saveError);
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
      showSuccess(t("gravatarPreference.saved"));
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
      showSuccess(t("datePreference.saved"));
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
      showSuccess(t("distancePreference.saved"));
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
        t("profileTranslations.83"),
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
        t("profileTranslations.69"),
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

      showSuccess(t("profileTranslations.70"));
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

      showSuccess(t("profileTranslations.71"));
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
        newPasskeyName.trim() || t("profileTranslations.passkeyDefaultName"),
      );
      setPasskeys(await getPasskeys(accessToken));
      setNewPasskeyName("");
      showSuccess(t("profileTranslations.passkeyRegistered"));
    } catch (passkeyError) {
      if (passkeyError?.name !== "NotAllowedError") showError(passkeyError);
    } finally {
      setSaving("");
    }
  }

  async function editPasskey(passkey) {
    const name = window.prompt(t("profileTranslations.passkeyNamePrompt"), passkey.name);
    if (!name?.trim() || name.trim() === passkey.name) return;
    setSaving(`passkey-rename:${passkey.id}`);
    try {
      const updated = await renamePasskey(accessToken, passkey.id, name.trim());
      setPasskeys((current) =>
        current.map((item) => item.id === passkey.id ? updated : item),
      );
      showSuccess(t("profileTranslations.passkeyRenamed"));
    } catch (passkeyError) {
      showError(passkeyError);
    } finally {
      setSaving("");
    }
  }

  async function removePasskey(passkey) {
    if (!window.confirm(t("profileTranslations.passkeyDeleteConfirm", { name: passkey.name }))) return;
    setSaving(`passkey-delete:${passkey.id}`);
    try {
      await deletePasskey(accessToken, passkey.id);
      setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
      showSuccess(t("profileTranslations.72"));
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
          ? t(`oauth.errors.${linkError.code}`, linkError.message || t("oauth.errors.default"))
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
          ? t(`oauth.errors.${unlinkError.code}`, unlinkError.message || t("oauth.errors.default"))
          : t("oauth.errors.default"),
      );
    } finally {
      setSaving("");
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">
        {t("profileTranslations.3")}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t("profileTranslations.1")}
        title={t("profileTranslations.2")}
        subtitle={t("profileTranslations.101")}
      />

      <nav
        aria-label={t("profileTranslations.0")}
        className="flex gap-7 overflow-x-auto border-b border-fb-border"
      >
        <TabButton
          active={activeTab === "settings"}
          onClick={() =>
            openTab("settings")
          }
        >
          {t("profileTranslations.0")}
        </TabButton>

        <TabButton
          active={activeTab === "units"}
          onClick={() => openTab("units")}
        >
          {t("unitSettingsTab.title")}
        </TabButton>

        <TabButton
          active={activeTab === "backup"}
          onClick={() =>
            openTab("backup")
          }
        >
          {t("profileTranslations.4")}
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
        <nav aria-label={t("profileTranslations.sectionsAria")} className="mb-6 hidden lg:sticky lg:top-6 lg:mb-0 lg:block">
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
          title={t("profileTranslations.groupProfile")}
          description={t("profileTranslations.102")}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <label className={labelClass}>
              {t("profileTranslations.15")}
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
              {t("profileTranslations.16")}
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
              {t("profileTranslations.17")}
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
              {t("profileTranslations.18")}
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
                <option value="de">{t("profileTranslations.13")}</option>
                <option value="en">English</option>
              </select>
            </label>

            <label className={labelClass}>
              {t("profileTranslations.19")}
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
              {t("profileTranslations.20")}
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
                  {t("profileTranslations.21")}
                </option>
                <option value="light">{t("profileTranslations.22")}</option>
                <option value="dark">{t("profileTranslations.23")}</option>
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
                ? t("profileTranslations.135")
                : t("profileTranslations.132")}
            </button>
          </div>
        </Section>
      </form>

      <form onSubmit={saveLanguage}>
        <Section id="language" title={t("profileTranslations.18")} description={t("profileTranslations.103")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className={labelClass}>{t("profileTranslations.11")}
              <select value={personalLanguage} onChange={(e)=>setPersonalLanguage(e.target.value)} className={fieldClass}>
                <option value="">{t("profileTranslations.12")}</option><option value="de">{t("profileTranslations.13")}</option><option value="en">English</option>
              </select>
            </label>
            <button disabled={saving==="language"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-50">{t("profileTranslations.14")}</button>
          </div>
        </Section>
      </form>

      <form onSubmit={saveHomeCountry}>
        <Section
          id="country"
          title={t("profileTranslations.countryTitle")}
          description={t("profileTranslations.104")}
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className={labelClass}>
              {t("profileTranslations.24")}
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
                {t("profileTranslations.25")}
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
                      {t("profileTranslations.122")}
                    </p>
                  );
                }

                return (
                  <>
                    <p className="mt-2 text-sm text-fb-text">
                      {selected.reportTitle}
                    </p>

                    <p className="mt-1 text-xs text-fb-muted">
                      {t("profileTranslations.countryPeriod", { value: selected.taxYearLabel })}
                      {" · "}
                      {t("profileTranslations.countryUnit", { value: selected.distanceUnit })}
                      {" · "}
                      {t("profileTranslations.countryCurrency", { value: selected.currency })}
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
                ? t("profileTranslations.135")
                : t("profileTranslations.133")}
            </button>
          </div>
        </Section>
      </form>

      <Section
        id="home"
        title={t("profileTranslations.homeTitle")}
        description={t("profileTranslations.108")}
      >
        {savedHomeLocation && (
          <div className="mb-5 rounded-lg border border-fb-border bg-fb-surface p-4">
            <div className="text-sm font-semibold">
              {t("profileTranslations.36")}
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
                ? t("profileTranslations.sourceGps")
                : t("profileTranslations.sourceManual")}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className={labelClass}>
            {t("profileTranslations.37")}
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
              placeholder={t("profileTranslations.homePlaceholder")}
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
              ? t("profileTranslations.136")
              : t("profileTranslations.129")}
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
                      t("profileTranslations.homeAddressSelected"),
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
                {t("profileTranslations.38")}
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
                  t("profileTranslations.noGeolocation"),
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
                      t("profileTranslations.homeGpsFound"),
                    );
                  } catch (gpsError) {
                    showError(gpsError);
                  } finally {
                    setGpsLoading(false);
                  }
                },
                (gpsError) => {
                  const messages = {
                    1: t("profileTranslations.gpsDenied"),
                    2: t("profileTranslations.gpsUnavailable"),
                    3: t("profileTranslations.gpsTimeout"),
                  };

                  setError(
                    messages[gpsError.code] ||
                      t("profileTranslations.gpsUnavailable"),
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
              ? t("profileTranslations.locating")
              : t("profileTranslations.useCurrentLocation")}
          </button>

          {!window.isSecureContext && (
            <p className="text-xs text-fb-danger">
              {t("profileTranslations.109")}
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
                ? t("profileTranslations.removing")
                : t("profileTranslations.removeHome")}
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
              ? t("profileTranslations.135")
              : t("profileTranslations.130")}
          </button>
        </div>
      </Section>

      <Section
        id="work"
        title={t("profileTranslations.workTitle")}
        description={t("profileTranslations.124")}
      >
        {savedWorkLocation && (
          <div className="mb-5 rounded-lg border border-fb-border bg-fb-surface p-4">
            <div className="text-sm font-semibold">{t("profileTranslations.36")}</div>
            <div className="mt-1 text-sm text-fb-text">
              {savedWorkLocation.address}
            </div>
            <div className="mt-1 text-xs text-fb-muted">
              {Number(savedWorkLocation.latitude).toFixed(6)}, {" "}
              {Number(savedWorkLocation.longitude).toFixed(6)}
              {" · "}
              {savedWorkLocation.source === "gps"
                ? t("profileTranslations.sourceGps")
                : t("profileTranslations.sourceManual")}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className={labelClass}>
            {t("profileTranslations.37")}
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
              placeholder={t("profileTranslations.workPlaceholder")}
              className={fieldClass}
            />
          </label>

          <button
            type="button"
            disabled={workSearchLoading || workQuery.trim().length < 3}
            onClick={findWorkCandidates}
            className="self-end rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent disabled:opacity-60"
          >
            {workSearchLoading ? t("profileTranslations.136") : t("profileTranslations.129")}
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
                    t("profileTranslations.workAddressSelected"),
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
                setError(t("profileTranslations.noGeolocation"));
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
                      t("profileTranslations.workGpsFound"),
                    );
                  } catch (gpsError) {
                    showError(gpsError);
                  } finally {
                    setWorkGpsLoading(false);
                  }
                },
                () => {
                  setError(t("profileTranslations.gpsUnavailable"));
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
              ? t("profileTranslations.locating")
              : t("profileTranslations.useCurrentLocation")}
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
              {saving === "work-delete" ? t("profileTranslations.removing") : t("profileTranslations.removeWork")}
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
            {saving === "work-save" ? t("profileTranslations.135") : t("profileTranslations.131")}
          </button>
        </div>
      </Section>

      <Section
        id="recognition"
        title={t("profileTranslations.recognitionTitle")}
        description={t("profileTranslations.125")}
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-end">
          <label className={labelClass}>
            {t("profileTranslations.39")}
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
            {t("profileTranslations.110")}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            disabled={saving === "location-radius"}
            onClick={saveRecognitionRadius}
            className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-60"
          >
            {saving === "location-radius" ? t("profileTranslations.135") : t("profileTranslations.saveRadius")}
          </button>
        </div>
      </Section>

      <Section
        id="places"
        title={t("profileTranslations.placesTitle")}
        description={t("profileTranslations.123")}
      >
        <form onSubmit={addSavedPlace} className="grid gap-3 md:grid-cols-3">
          <input required placeholder={t("profileTranslations.placeNamePlaceholder")} value={newPlace.name} onChange={(e)=>setNewPlace(p=>({...p,name:e.target.value}))} className={fieldClass} />
          <input placeholder={t("profileTranslations.address")} value={newPlace.address} onChange={(e)=>setNewPlace(p=>({...p,address:e.target.value}))} className={fieldClass} />
          <select value={newPlace.suggestedType} onChange={(e)=>setNewPlace(p=>({...p,suggestedType:e.target.value}))} className={fieldClass}>
            <option value="">{t("profileTranslations.5")}</option><option value="business">{t("profileTranslations.6")}</option><option value="private">{t("profileTranslations.7")}</option><option value="commute">{t("profileTranslations.8")}</option>
          </select>
          <input required type="number" step="any" placeholder={t("profileTranslations.latitude")} value={newPlace.latitude} onChange={(e)=>setNewPlace(p=>({...p,latitude:e.target.value}))} className={fieldClass} />
          <input required type="number" step="any" placeholder={t("profileTranslations.longitude")} value={newPlace.longitude} onChange={(e)=>setNewPlace(p=>({...p,longitude:e.target.value}))} className={fieldClass} />
          <div className="flex gap-2"><input required type="number" min="25" max="5000" value={newPlace.radiusMeters} onChange={(e)=>setNewPlace(p=>({...p,radiusMeters:e.target.value}))} className={fieldClass} /><button disabled={saving==="saved-place"} className="mt-2 rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text">{t("profileTranslations.9")}</button></div>
        </form>
        <div className="mt-5 divide-y divide-fb-border">
          {savedPlaces.map((place)=>(
            <div key={place.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div><div className="font-semibold">{place.name}</div><div className="text-fb-muted">{place.address || `${place.latitude}, ${place.longitude}`} · {place.radiusMeters || locationRecognitionRadiusMeters} m</div></div>
              <button type="button" onClick={()=>removeSavedPlace(place.id)} className="rounded border border-fb-border px-3 py-1.5 text-xs">{t("profileTranslations.10")}</button>
            </div>
          ))}
        </div>
      </Section>

      <form onSubmit={saveTracking}>
        <Section
          id="tracking"
          title={t("profileTranslations.trackingTitle")}
          description={t("profileTranslations.105")}
        >
          <div className="space-y-5">
            <label className="flex items-start justify-between gap-6 rounded-lg border border-fb-border bg-fb-surface p-4">
              <span>
                <span className="block text-sm font-semibold">
                  {t("profileTranslations.26")}
                </span>
                <span className="mt-1 block text-sm text-fb-muted">
                  {t("profileTranslations.106")}
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
                {t("profileTranslations.27")}
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
                    {t("profileTranslations.28")}
                  </option>
                  <option value="balanced">
                    {t("profileTranslations.29")}
                  </option>
                  <option value="battery">
                    {t("profileTranslations.30")}
                  </option>
                </select>
              </label>

              <label className={labelClass}>
                {t("profileTranslations.31")}
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
                {t("profileTranslations.32")}
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
                    {t("profileTranslations.33")}
                  </option>
                </select>
        </label>
              <div className="mt-5">
                <h3 className="text-sm font-semibold">{t("profileTranslations.34")}</h3>
                <p className="mt-1 text-xs text-fb-muted">{t("profileTranslations.107")}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[
                    ["private", t("profileTranslations.7")],
                    ["business", t("profileTranslations.6")],
                    ["commute", t("profileTranslations.8")],
                    ["unclassified", t("profileTranslations.unclassified")],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-3 rounded-lg border border-fb-border p-3 text-sm">
                      <input type="checkbox" checked={Boolean(tracking.mapRouteColors?.[key])}
                        onChange={(event) => setTracking((current) => ({
                          ...current, mapRouteColors: { ...current.mapRouteColors, [key]: event.target.checked ? DEFAULT_ROUTE_COLORS[key] : null },
                        }))} />
                      <span className="flex-1">{label}</span>
                      <input type="color" aria-label={t("profileTranslations.colorFor", { label })} disabled={!tracking.mapRouteColors?.[key]}
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
                  {t("profileTranslations.35")}
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
                ? t("profileTranslations.135")
                : t("profileTranslations.134")}
            </button>
          </div>
        </Section>
      </form>

      <form onSubmit={savePassword}>
        <Section
          id="credentials"
          title={t("profileTranslations.passwordTitle")}
          description={t("profileTranslations.111")}
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <label className={labelClass}>
              {t("profileTranslations.40")}
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
              {t("profileTranslations.41")}
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
              {t("profileTranslations.42")}
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
                ? t("profileTranslations.137")
                : t("profileTranslations.95")}
            </button>
          </div>
        </Section>
      </form>

      <Section
        id="security"
        title={t("profileTranslations.groupSecurity")}
        description={t("profileTranslations.126")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-fb-border bg-fb-surface p-4">
            <div className="font-semibold">
              {t("profileTranslations.43")}
            </div>
            <div className="mt-1 text-sm text-fb-muted">
              {!authMethods.totp
                ? t("authMethods.totpDisabled")
                : user?.totpEnabled
                  ? t("profileTranslations.127")
                  : t("profileTranslations.128")}
            </div>
          </div>

          {!authMethods.passkeys ? (
          <div className="rounded-lg border border-fb-border bg-fb-surface p-4 sm:col-span-2">
            <div className="font-semibold">{t("profileTranslations.44")}</div>
            <p className="mt-1 text-sm text-fb-muted">{t("authMethods.passkeysDisabled")}</p>
          </div>
          ) : (
          <div className="rounded-lg border border-fb-border bg-fb-surface p-4 sm:col-span-2">
            <div className="font-semibold">{t("profileTranslations.44")}</div>
            <p className="mt-1 text-sm text-fb-muted">
              {t("profileTranslations.112")}
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={newPasskeyName}
                onChange={(event) => setNewPasskeyName(event.target.value)}
                placeholder={t("profileTranslations.passkeyNamePlaceholder")}
                maxLength={120}
                className={fieldClass}
              />
              <button
                type="button"
                onClick={addPasskey}
                disabled={saving === "passkey-add" || user?.passkeyEnabled === false}
                className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60"
              >
                {saving === "passkey-add" ? t("profileTranslations.registering") : t("profileTranslations.96")}
              </button>
            </div>

            {user?.passkeyEnabled === false && (
              <p className="mt-3 text-sm text-fb-danger">
                {t("profileTranslations.113")}
              </p>
            )}

            <div className="mt-4 divide-y divide-fb-border rounded-lg border border-fb-border">
              {passkeys.length === 0 ? (
                <p className="p-4 text-sm text-fb-muted">{t("profileTranslations.45")}</p>
              ) : passkeys.map((passkey) => (
                <div key={passkey.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold">{passkey.name}</div>
                    <div className="mt-1 text-xs text-fb-muted">
                      {t("profileTranslations.passkeyCreated", { date: new Date(passkey.createdAt).toLocaleString(locale) })}
                      {passkey.lastUsedAt ? ` · ${t("profileTranslations.passkeyLastUsed", { date: new Date(passkey.lastUsedAt).toLocaleString(locale) })}` : ""}
                      {passkey.backedUp ? ` · ${t("profileTranslations.passkeySynced")}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => editPasskey(passkey)} className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-accent">
                      {t("profileTranslations.46")}
                    </button>
                    <button type="button" onClick={() => removePasskey(passkey)} className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold text-fb-danger hover:border-fb-danger">
                      {t("profileTranslations.47")}
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
        title={t("profileTranslations.devicesTitle")}
        description={t("profileTranslations.114")}
      >
        <div className="mb-5 flex justify-end">
          <button
            type="button"
            onClick={() =>
              setAddDeviceModalOpen(true)
            }
            className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent"
          >
            {t("profileTranslations.48")}
          </button>
        </div>

        <div className="divide-y divide-fb-border">
          {devices.length === 0 ? (
            <div className="py-6 text-sm text-fb-muted">
              {t("profileTranslations.49")}
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
                        {t("profileTranslations.50")}
                      </span>
                    )}

                    {device.revokedAt && (
                      <span className="rounded-full border border-fb-border px-2 py-0.5 text-xs text-fb-muted">
                        {t("profileTranslations.51")}
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
                        ? t("profileTranslations.signingOut")
                        : t("profileTranslations.97")}
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
            t("profileTranslations.98"),
          );
        }}
      />
        </div>
      </div>
        </>
      ) : activeTab === "units" ? (
        <>
          <header className="space-y-1">
            <h2 className="text-xl font-semibold">{t("unitSettingsTab.title")}</h2>
            <p className="text-sm text-fb-muted">{t("unitSettingsTab.description")}</p>
          </header>
          {message && <div className="rounded-xl border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent">{message}</div>}
          {error && <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>}
      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
      <form onSubmit={saveSpeedUnit} className="h-full">
        <Section title={t("speedPreference.title")} description={t("speedPreference.description")}>
          <label className={labelClass} htmlFor="profile-speed-unit">{t("speedPreference.label")}</label>
          <select id="profile-speed-unit" className={fieldClass} value={speedUnit} onChange={(event) => setSpeedUnit(event.target.value)}>
            <option value="kmh">{t("speedPreference.kmh")}</option>
            <option value="mph">{t("speedPreference.mph")}</option>
          </select>
          <div className="mt-6 flex justify-end"><button type="submit" disabled={saving === "speed-unit"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "speed-unit" ? t("speedPreference.saving") : t("speedPreference.save")}</button></div>
        </Section>
      </form>

      <form onSubmit={saveTimeFormat} className="h-full">
        <Section title={t("timePreference.title")} description={t("timePreference.description")}>
          <label className={labelClass} htmlFor="profile-time-format">{t("timePreference.label")}</label>
          <select id="profile-time-format" className={fieldClass} value={timeFormat} onChange={(event) => setTimeFormat(event.target.value)}>
            <option value="24h">{t("timePreference.24h")}</option>
            <option value="12h">{t("timePreference.12h")}</option>
          </select>
          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={saving === "time-format"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">
              {saving === "time-format" ? t("timePreference.saving") : t("timePreference.save")}
            </button>
          </div>
        </Section>
      </form>

      <form onSubmit={saveDateFormat} className="h-full">
        <Section title={t("datePreference.title")} description={t("datePreference.description")}>
          <label className={labelClass} htmlFor="profile-date-format">{t("datePreference.label")}</label>
          <select id="profile-date-format" className={fieldClass} value={dateFormat} onChange={(event) => setDateFormat(event.target.value)}>
            <option value="EU">{t("datePreference.EU")}</option>
            <option value="US">{t("datePreference.US")}</option>
          </select>
          <div className="mt-6 flex justify-end"><button type="submit" disabled={saving === "date-format"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "date-format" ? t("datePreference.saving") : t("datePreference.save")}</button></div>
        </Section>
      </form>

      <form onSubmit={saveDistanceUnit} className="h-full">
        <Section title={t("distancePreference.title")} description={t("distancePreference.description")}>
          <label className={labelClass} htmlFor="profile-distance-unit">{t("distancePreference.label")}</label>
          <select id="profile-distance-unit" className={fieldClass} value={distanceUnit} onChange={(event) => setDistanceUnit(event.target.value)}>
            <option value="km">{t("distancePreference.km")}</option>
            <option value="mi">{t("distancePreference.mi")}</option>
          </select>
          <div className="mt-6 flex justify-end"><button type="submit" disabled={saving === "distance-unit"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "distance-unit" ? t("distancePreference.saving") : t("distancePreference.save")}</button></div>
        </Section>
      </form>

      <form onSubmit={saveGravatar} className="h-full">
        <Section title={t("gravatarPreference.title")} description={t("gravatarPreference.description")}>
          <label className={labelClass} htmlFor="profile-gravatar">{t("gravatarPreference.label")}</label>
          <select
            id="profile-gravatar"
            className={fieldClass}
            value={gravatarEnabled ? "on" : "off"}
            disabled={!gravatarAvailable}
            onChange={(event) => setGravatarEnabled(event.target.value === "on")}
          >
            <option value="on">{t("gravatarPreference.on")}</option>
            <option value="off">{t("gravatarPreference.off")}</option>
          </select>
          {!gravatarAvailable && <p className="mt-2 text-sm text-fb-muted">{t("gravatarPreference.disabledByAdmin")}</p>}
          <div className="mt-6 flex justify-end"><button type="submit" disabled={!gravatarAvailable || saving === "gravatar"} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">{saving === "gravatar" ? t("gravatarPreference.saving") : t("gravatarPreference.save")}</button></div>
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
