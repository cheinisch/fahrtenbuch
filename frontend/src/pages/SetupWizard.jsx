import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { getCurrentUser } from "../api/auth.js";
import {
  changePassword,
  completeAdminSetup,
  getAdminSettings,
  getAdminSetup,
  updateAdminSettings,
  updatePersonalSettings,
  updateProfile,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import GeocodingSettings from "../components/admin/GeocodingSettings.jsx";
import MailStatusPanel from "../components/admin/MailStatusPanel.jsx";
import VehicleStep from "../components/wizard/VehicleStep.jsx";
import WizardFrame, {
  ChoiceChips,
  StatusRow,
  WizardNotice,
  WizardStepHeader,
  WizardToggle,
  wizardFieldClass,
} from "../components/wizard/WizardFrame.jsx";
import {
  ConnectAppCard,
  PasswordFields,
  SummaryList,
  emptyPasswords,
  useWizardNavigation,
  validatePasswords,
} from "../components/wizard/wizardParts.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useFeatures } from "../lib/features.jsx";
import { currentAppUrl } from "../lib/basePath.js";

const STEP_IDS = ["welcome", "account", "server", "mail", "geocoding", "login", "vehicle", "done"];
const OPTIONAL_STEPS = ["vehicle"];

// Ersteinrichtung des Servers: erscheint beim ersten Admin-Login, solange
// 'setup.completed' fehlt. Was nur über die .env geht, wird als Status gezeigt.
export default function SetupWizard() {
  const { user, accessToken, updateUser, signOut } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const { loaded, setupCompleted, reload } = useFeatures();
  const navigate = useNavigate();
  const nav = useWizardNavigation("fahrtenbuch.setupWizard", STEP_IDS);

  const [setup, setSetup] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState(language);
  const [profile, setProfile] = useState({ displayName: user?.displayName || "", email: user?.email || "" });
  const [passwords, setPasswords] = useState(emptyPasswords);
  const [gravatarEnabled, setGravatarEnabled] = useState(true);
  const [vehicles, setVehicles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getAdminSetup(accessToken), getAdminSettings(accessToken)])
      .then(([setupResult, settingsResult]) => {
        if (!active) return;
        setSetup(setupResult);
        setGravatarEnabled(setupResult.gravatar?.enabled !== false);
        if (settingsResult?.defaultLanguage) setSelectedLanguage(settingsResult.defaultLanguage);
      })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [accessToken]);

  const steps = useMemo(() => STEP_IDS.map((id) => ({
    id,
    label: t(`setup.steps.${id}.label`),
    hint: t(`setup.steps.${id}.hint`),
  })), [t]);

  if (user?.role !== "admin") return <Navigate to="/" replace />;
  // Bereits eingerichtet (z. B. zweiter Tab): ab in die App
  if (loaded && setupCompleted) return <Navigate to="/" replace />;

  const env = setup?.environment;
  const passwordRequired = Boolean(user?.forcePasswordChange);
  const originMatches = env ? env.publicBaseUrl.replace(/\/+$/, "") === currentAppUrl() : true;
  const rpIdMatches = env ? env.passkeys.rpId === window.location.hostname : true;

  async function saveStep(stepId) {
    switch (stepId) {
      case "welcome":
        // Erste Wahl gilt für den Server und das eigene Konto
        await updateAdminSettings(accessToken, { defaultLanguage: selectedLanguage });
        await updatePersonalSettings(accessToken, { language: selectedLanguage });
        break;
      case "account": {
        const problem = validatePasswords(passwords, passwordRequired, t);
        if (problem) throw new Error(problem);
        if (!profile.email.trim()) throw new Error(t("setup.account.emailRequired"));
        const updated = await updateProfile(accessToken, {
          displayName: profile.displayName.trim() || null,
          email: profile.email.trim(),
        });
        updateUser({ ...user, ...updated });
        if (passwords.next) {
          await changePassword(accessToken, { currentPassword: passwords.current, newPassword: passwords.next });
          setPasswords(emptyPasswords);
          updateUser(await getCurrentUser(accessToken));
        }
        break;
      }
      case "login":
        await updateAdminSettings(accessToken, { gravatarEnabled });
        break;
      default:
        break;
    }
  }

  async function finish() {
    const result = await completeAdminSetup(accessToken);
    if (result?.user) updateUser(result.user);
    nav.clear();
    await reload();
    navigate("/", { replace: true });
  }

  async function next() {
    setBusy(true);
    setError("");
    try {
      if (nav.stepId === "done") {
        await finish();
        return;
      }
      await saveStep(nav.stepId);
      nav.goTo(nav.index + 1);
    } catch (stepError) {
      setError(stepError.message || t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    setError("");
    nav.goTo(nav.index + 1);
  }

  const nextLabel = {
    welcome: t("setup.welcome.start"),
    done: t("setup.done.finish"),
  }[nav.stepId] || t("wizard.next");

  const ownVehicles = vehicles.filter((vehicle) => vehicle.isOwner !== false);
  const mailConfigured = Boolean(setup?.mail?.configured);

  return (
    <WizardFrame
      title={t("setup.title")}
      steps={steps}
      currentIndex={nav.index}
      maxReachedIndex={nav.maxReached}
      onStepSelect={(index) => { setError(""); nav.goTo(index); }}
      onBack={nav.index > 0 ? () => { setError(""); nav.goTo(nav.index - 1); } : null}
      onNext={next}
      onSkip={OPTIONAL_STEPS.includes(nav.stepId) ? skip : null}
      nextLabel={nextLabel}
      busy={busy}
      nextDisabled={!setup && nav.stepId !== "welcome"}
      error={error}
      onSignOut={async () => { await signOut(); navigate("/login", { replace: true }); }}
    >
      {nav.stepId === "welcome" && (
        <>
          <WizardStepHeader eyebrow={t("setup.welcome.eyebrow")} title={t("setup.welcome.title")} subtitle={t("setup.welcome.text")} />
          <ChoiceChips
            label={t("setup.welcome.language")}
            value={selectedLanguage}
            onChange={(value) => { setSelectedLanguage(value); setLanguage(value); }}
            options={[{ value: "de", label: "Deutsch" }, { value: "en", label: "English" }]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-fb-border p-4">
              <div className="text-sm font-semibold">{t("setup.welcome.requiredTitle")}</div>
              <div className="mt-1 text-sm leading-relaxed text-fb-muted">{t("setup.welcome.requiredText")}</div>
            </div>
            <div className="rounded-xl border border-fb-border p-4">
              <div className="text-sm font-semibold">{t("setup.welcome.optionalTitle")}</div>
              <div className="mt-1 text-sm leading-relaxed text-fb-muted">{t("setup.welcome.optionalText")}</div>
            </div>
          </div>
        </>
      )}

      {nav.stepId === "account" && (
        <>
          <WizardStepHeader
            title={t("setup.account.title")}
            subtitle={passwordRequired ? t("setup.account.textForced") : t("setup.account.text")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              {t("setup.account.displayName")}
              <input className={wizardFieldClass} value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} autoComplete="name" />
            </label>
            <label className="block text-sm font-medium">
              {t("setup.account.email")}
              <input type="email" className={wizardFieldClass} value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} autoComplete="email" />
            </label>
          </div>
          <div className="space-y-3">
            <h2 className="text-base font-bold">{passwordRequired ? t("setup.account.passwordTitleForced") : t("setup.account.passwordTitle")}</h2>
            <PasswordFields
              value={passwords}
              onChange={setPasswords}
              currentLabel={passwordRequired ? t("setup.account.startPassword") : t("wizard.password.current")}
              required={passwordRequired}
            />
          </div>
          <WizardNotice icon={LockClosedIcon}>{t("setup.account.envHint")}</WizardNotice>
        </>
      )}

      {nav.stepId === "server" && (
        <>
          <WizardStepHeader title={t("setup.server.title")} subtitle={t("setup.server.text")} />
          {env && (
            <div className="divide-y divide-fb-border rounded-xl border border-fb-border">
              <StatusRow
                label={t("setup.server.publicUrl")}
                hint={t("setup.server.publicUrlHint")}
                value={env.publicBaseUrl}
                ok={env.publicBaseUrlConfigured && originMatches}
              />
              <StatusRow
                label={t("setup.server.passkeys")}
                hint={t("setup.server.passkeysHint")}
                value={env.passkeys.enabled ? env.passkeys.rpId : t("setup.server.disabled")}
                ok={env.passkeys.enabled ? rpIdMatches : undefined}
              />
              <StatusRow label={t("setup.server.timezone")} value={env.timezone} ok />
              <StatusRow label={t("setup.server.channel")} value={env.channel === "release" ? "latest" : "dev"} />
            </div>
          )}
          {env && (!env.publicBaseUrlConfigured || !originMatches) && (
            <WizardNotice tone="warn" icon={ExclamationTriangleIcon}>
              {t("setup.server.originMismatch", { configured: env.publicBaseUrl, current: currentAppUrl() })}
            </WizardNotice>
          )}
          <WizardNotice icon={InformationCircleIcon}>{t("setup.server.envHint")}</WizardNotice>
        </>
      )}

      {nav.stepId === "mail" && (
        <>
          <WizardStepHeader title={t("setup.mail.title")} subtitle={t("setup.mail.text")} optional />
          <MailStatusPanel initialStatus={setup?.mail} />
        </>
      )}

      {nav.stepId === "geocoding" && (
        <>
          <WizardStepHeader title={t("setup.geocoding.title")} subtitle={t("setup.geocoding.text")} />
          <GeocodingSettings />
        </>
      )}

      {nav.stepId === "login" && (
        <>
          <WizardStepHeader title={t("setup.login.title")} subtitle={t("setup.login.text")} />
          {env && (
            <div className="divide-y divide-fb-border rounded-xl border border-fb-border">
              <StatusRow label={t("setup.login.google")} value={env.oauth.google ? t("setup.login.active") : t("setup.login.notConfigured")} ok={env.oauth.google || undefined} />
              <StatusRow label={t("setup.login.microsoft")} value={env.oauth.microsoft ? t("setup.login.active") : t("setup.login.notConfigured")} ok={env.oauth.microsoft || undefined} />
            </div>
          )}
          {env && (
            <WizardNotice icon={InformationCircleIcon}>
              {t("setup.login.envHint")}{" "}
              <code className="break-all rounded bg-fb-main px-1 py-0.5 font-mono text-xs ring-1 ring-fb-border">{env.oauth.redirectUriTemplate}</code>
            </WizardNotice>
          )}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-fb-border p-4">
            <div>
              <div className="text-sm font-semibold">{t("setup.login.gravatar")}</div>
              <div className="mt-0.5 text-sm text-fb-muted">{t("setup.login.gravatarHint")}</div>
            </div>
            <WizardToggle checked={gravatarEnabled} onChange={setGravatarEnabled} label={t("setup.login.gravatar")} />
          </div>
        </>
      )}

      {nav.stepId === "vehicle" && (
        <>
          <WizardStepHeader title={t("setup.vehicle.title")} subtitle={t("setup.vehicle.text")} optional />
          <VehicleStep onVehiclesChange={setVehicles} />
        </>
      )}

      {nav.stepId === "done" && (
        <>
          <WizardStepHeader eyebrow={t("setup.done.eyebrow")} title={t("setup.done.title")} subtitle={t("setup.done.text")} />
          <div className="flex flex-wrap gap-5">
            <div className="min-w-0 flex-[999_1_320px]">
              <SummaryList
                rows={[
                  { label: t("setup.done.account"), value: user?.forcePasswordChange ? t("setup.done.passwordPending") : t("setup.done.accountOk"), ok: !user?.forcePasswordChange },
                  {
                    label: t("setup.done.mail"),
                    value: mailConfigured ? t("setup.done.mailOk") : t("setup.done.mailMissing"),
                    ok: mailConfigured,
                  },
                  {
                    label: t("setup.done.oauth"),
                    value: [env?.oauth.google && "Google", env?.oauth.microsoft && "Microsoft"].filter(Boolean).join(" · ") || t("setup.done.passwordOnly"),
                    ok: true,
                  },
                  { label: t("setup.done.gravatar"), value: gravatarEnabled ? t("setup.done.gravatarOn") : t("setup.done.gravatarOff"), ok: true },
                  {
                    label: t("setup.done.vehicles"),
                    value: ownVehicles.length ? t("setup.done.vehicleCount", { count: ownVehicles.length }) : t("setup.done.vehicleSkipped"),
                    ok: ownVehicles.length > 0,
                  },
                ]}
              />
            </div>
            <div className="flex-[1_1_240px]">
              <ConnectAppCard />
            </div>
          </div>
        </>
      )}
    </WizardFrame>
  );
}
