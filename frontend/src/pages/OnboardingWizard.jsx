import { CheckCircleIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { getCurrentUser, getOAuthProviders } from "../api/auth.js";
import {
  changePassword,
  completeOnboarding,
  getPersonalSettings,
  updatePersonalSettings,
  updateProfile,
} from "../api/app.js";
import { getLinkedAccounts, startAccountLink, unlinkAccount } from "../api/oauth.js";
import { pendingAssistant } from "../auth/OnboardingGate.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import VehicleStep from "../components/wizard/VehicleStep.jsx";
import WizardFrame, {
  ChoiceChips,
  WizardNotice,
  WizardStepHeader,
  WizardToggle,
  wizardFieldClass,
  wizardPrimaryButtonClass,
  wizardSecondaryButtonClass,
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
import { codeKey } from "../i18n/translate.js";
import { useFeatures } from "../lib/features.jsx";
import { GRAVATAR_SETTING_EVENT } from "../lib/gravatar.js";

// Assistent beim ersten Login eines vom Admin angelegten Kontos. Ist der Assistent schon
// erledigt und nur ein Passwortwechsel erzwungen, bleibt allein der Passwort-Schritt.
export default function OnboardingWizard() {
  const { user, accessToken } = useAuth();
  const { setupCompleted, loaded } = useFeatures();
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      getOAuthProviders().catch(() => []),
      getLinkedAccounts(accessToken).catch(() => []),
      getPersonalSettings(accessToken).catch(() => null),
    ]).then(([providerList, linkedList, personal]) => {
      if (!active) return;
      setData({
        providers: Array.isArray(providerList) ? providerList : providerList?.providers || [],
        linked: Array.isArray(linkedList) ? linkedList : linkedList?.identities || [],
        gravatar: personal?.settings ? personal.settings.gravatarEnabled !== false : true,
      });
    });
    return () => { active = false; };
    // Nur einmal laden; ein Token-Refresh ändert nichts an den Daten
  }, []);

  // Nichts mehr zu tun (oder Admin muss erst den Server einrichten)
  if (loaded) {
    const target = pendingAssistant(user, setupCompleted);
    if (target !== "/welcome") return <Navigate to={target || "/"} replace />;
  }
  // Schritte erst festlegen, wenn bekannt ist, ob es Anmelde-Anbieter gibt
  if (!data) return null;

  return <OnboardingFlow initial={data} />;
}

function OnboardingFlow({ initial }) {
  const { user, accessToken, updateUser, signOut } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const { gravatarEnabled: gravatarAllowed } = useFeatures();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const providers = initial.providers;
  const [linked, setLinked] = useState(initial.linked);
  const [profile, setProfile] = useState({ displayName: user?.displayName || "", email: user?.email || "" });
  const [selectedLanguage, setSelectedLanguage] = useState(language);
  const [gravatar, setGravatar] = useState(initial.gravatar);
  const [passwords, setPasswords] = useState(emptyPasswords);
  const [vehicles, setVehicles] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Beim Start festhalten: nach dem Passwortwechsel darf der Schritt nicht verschwinden
  const [onlyPassword] = useState(() => Boolean(user?.onboardingCompleted));
  const [needsPassword] = useState(() => Boolean(user?.forcePasswordChange) && user?.hasPassword !== false);
  const enabledProviders = providers.filter((provider) => provider.enabled);

  const stepIds = useMemo(() => {
    if (onlyPassword) return ["password"];
    return [
      ...(needsPassword ? ["password"] : []),
      "profile",
      ...(enabledProviders.length ? ["accounts"] : []),
      "vehicles",
      "done",
    ];
  }, [onlyPassword, needsPassword, enabledProviders.length]);

  // Rückkehr vom OAuth-Anbieter: direkt beim Konten-Schritt weitermachen
  const oauthLinked = searchParams.get("oauthLinked");
  const oauthError = searchParams.get("oauthError");
  const nav = useWizardNavigation(
    `fahrtenbuch.onboarding.${user?.id}`,
    stepIds,
    oauthLinked || oauthError ? "accounts" : null,
  );

  useEffect(() => {
    if (!oauthLinked && !oauthError) return;
    if (oauthError) {
      setError(t(`oauth.errors.${codeKey(oauthError)}`, t("oauth.errors.default")));
    } else {
      const name = { google: "Google", microsoft: "Microsoft" }[oauthLinked] || oauthLinked;
      setMessage(t("oauth.linkedSuccess", { provider: name }));
    }
    setSearchParams({}, { replace: true });
  }, [oauthLinked, oauthError]);

  const steps = useMemo(() => stepIds.map((id) => ({
    id,
    label: t(`onboarding.steps.${id}.label`),
    hint: t(`onboarding.steps.${id}.hint`),
  })), [stepIds, t]);

  async function finish() {
    const updated = await completeOnboarding(accessToken);
    updateUser({ ...user, ...updated });
    nav.clear();
    navigate("/", { replace: true });
  }

  async function saveStep(stepId) {
    switch (stepId) {
      case "password": {
        const problem = validatePasswords(passwords, true, t);
        if (problem) throw new Error(problem);
        await changePassword(accessToken, { currentPassword: passwords.current, newPassword: passwords.next });
        setPasswords(emptyPasswords);
        const fresh = await getCurrentUser(accessToken);
        updateUser(fresh);
        if (onlyPassword) {
          nav.clear();
          navigate("/", { replace: true });
          return false;
        }
        break;
      }
      case "profile": {
        if (!profile.email.trim()) throw new Error(t("onboarding.profile.emailRequired"));
        const updated = await updateProfile(accessToken, {
          displayName: profile.displayName.trim() || null,
          email: profile.email.trim(),
        });
        updateUser({ ...user, ...updated });
        const settings = await updatePersonalSettings(accessToken, {
          language: selectedLanguage,
          ...(gravatarAllowed ? { gravatarEnabled: gravatar } : {}),
        });
        window.dispatchEvent(new CustomEvent(GRAVATAR_SETTING_EVENT, {
          detail: settings?.gravatarAvailable !== false && settings?.gravatarEnabled !== false,
        }));
        break;
      }
      default:
        break;
    }
    return true;
  }

  async function next() {
    setBusy("next");
    setError("");
    setMessage("");
    try {
      if (nav.stepId === "done") {
        await finish();
        return;
      }
      const proceed = await saveStep(nav.stepId);
      if (proceed) nav.goTo(nav.index + 1);
    } catch (stepError) {
      setError(stepError.message || t("common.requestFailed"));
    } finally {
      setBusy("");
    }
  }

  async function link(provider) {
    setBusy(`link:${provider.id}`);
    setError("");
    try {
      const { authorizationUrl } = await startAccountLink(accessToken, provider.id);
      window.location.assign(authorizationUrl);
    } catch (linkError) {
      setError(linkError?.code
        ? t(`oauth.errors.${codeKey(linkError.code)}`, linkError.message || t("oauth.errors.default"))
        : linkError.message);
      setBusy("");
    }
  }

  async function unlink(account) {
    setBusy(`unlink:${account.id}`);
    setError("");
    try {
      await unlinkAccount(accessToken, account.id);
      setLinked((current) => current.filter((item) => item.id !== account.id));
    } catch (unlinkError) {
      setError(unlinkError.message);
    } finally {
      setBusy("");
    }
  }

  const nextLabel = {
    password: onlyPassword ? t("onboarding.password.saveOnly") : t("onboarding.password.save"),
    done: t("onboarding.done.finish"),
  }[nav.stepId] || t("wizard.next");

  const ownVehicles = vehicles.filter((vehicle) => vehicle.isOwner !== false);
  const defaultVehicle = vehicles.find((vehicle) => vehicle.isDefault);
  const linkedNames = linked.map((account) => enabledProviders.find((provider) => provider.id === account.provider)?.name || account.provider);

  return (
    <WizardFrame
      title={t("onboarding.title")}
      steps={steps}
      currentIndex={nav.index}
      maxReachedIndex={nav.maxReached}
      onStepSelect={(index) => { setError(""); nav.goTo(index); }}
      onBack={nav.index > 0 ? () => { setError(""); nav.goTo(nav.index - 1); } : null}
      onNext={next}
      onSkip={nav.stepId === "accounts" ? () => nav.goTo(nav.index + 1) : null}
      nextLabel={nextLabel}
      busy={busy === "next"}
      error={error}
      onSignOut={async () => { await signOut(); navigate("/login", { replace: true }); }}
    >
      {nav.stepId === "password" && (
        <>
          <WizardStepHeader
            eyebrow={onlyPassword ? null : t("onboarding.password.eyebrow")}
            title={onlyPassword ? t("onboarding.password.titleOnly") : t("onboarding.password.title", { name: user?.displayName || user?.username || "" })}
            subtitle={onlyPassword ? t("onboarding.password.textOnly") : t("onboarding.password.text")}
          />
          <PasswordFields value={passwords} onChange={setPasswords} currentLabel={t("onboarding.password.temporary")} required />
          <WizardNotice icon={LockClosedIcon}>{t("onboarding.password.notice")}</WizardNotice>
        </>
      )}

      {nav.stepId === "profile" && (
        <>
          {!needsPassword && (
            <p className="text-sm font-semibold text-fb-accent-strong">{t("onboarding.profile.eyebrow", { name: user?.displayName || user?.username || "" })}</p>
          )}
          <WizardStepHeader title={t("onboarding.profile.title")} subtitle={t("onboarding.profile.text")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              {t("onboarding.profile.displayName")}
              <input className={wizardFieldClass} value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} autoComplete="name" />
            </label>
            <label className="block text-sm font-medium">
              {t("onboarding.profile.email")}
              <input type="email" className={wizardFieldClass} value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} autoComplete="email" />
              <span className="mt-1 block text-xs text-fb-muted">{t("onboarding.profile.emailHint")}</span>
            </label>
          </div>
          <ChoiceChips
            label={t("common.language")}
            value={selectedLanguage}
            onChange={(value) => { setSelectedLanguage(value); setLanguage(value); }}
            options={[{ value: "de", label: "Deutsch" }, { value: "en", label: "English" }]}
          />
          {gravatarAllowed && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-fb-border p-4">
              <div>
                <div className="text-sm font-semibold">{t("onboarding.profile.gravatar")}</div>
                <div className="mt-0.5 text-sm text-fb-muted">{t("onboarding.profile.gravatarHint")}</div>
              </div>
              <WizardToggle checked={gravatar} onChange={setGravatar} label={t("onboarding.profile.gravatar")} />
            </div>
          )}
        </>
      )}

      {nav.stepId === "accounts" && (
        <>
          <WizardStepHeader title={t("onboarding.accounts.title")} subtitle={t("onboarding.accounts.text")} optional />
          {message && <WizardNotice tone="success" icon={CheckCircleIcon}>{message}</WizardNotice>}
          <ul className="space-y-2.5">
            {enabledProviders.map((provider) => {
              const account = linked.find((item) => item.provider === provider.id);
              return (
                <li key={provider.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fb-border px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{provider.name}</div>
                    <div className={`text-sm ${account ? "text-fb-accent-strong" : "text-fb-muted"}`}>
                      {account ? t("onboarding.accounts.linkedAs", { account: account.email || account.displayName || provider.name }) : t("oauth.notLinked")}
                    </div>
                  </div>
                  {account ? (
                    <button type="button" onClick={() => unlink(account)} disabled={Boolean(busy)} className={wizardSecondaryButtonClass}>
                      {t("oauth.unlink")}
                    </button>
                  ) : (
                    <button type="button" onClick={() => link(provider)} disabled={Boolean(busy)} className={wizardPrimaryButtonClass}>
                      {busy === `link:${provider.id}` ? t("oauth.linking") : t("onboarding.accounts.link", { provider: provider.name })}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {nav.stepId === "vehicles" && (
        <>
          <WizardStepHeader title={t("onboarding.vehicles.title")} subtitle={t("onboarding.vehicles.text")} />
          <VehicleStep onVehiclesChange={setVehicles} />
        </>
      )}

      {nav.stepId === "done" && (
        <>
          <WizardStepHeader eyebrow={t("onboarding.done.eyebrow")} title={t("onboarding.done.title")} subtitle={t("onboarding.done.text")} />
          <div className="flex flex-wrap gap-5">
            <div className="min-w-0 flex-[999_1_320px]">
              <SummaryList
                rows={[
                  ...(needsPassword ? [{ label: t("onboarding.done.password"), value: t("onboarding.done.passwordOk"), ok: true }] : []),
                  { label: t("common.language"), value: selectedLanguage === "en" ? "English" : "Deutsch", ok: true },
                  ...(enabledProviders.length ? [{
                    label: t("onboarding.done.accounts"),
                    value: linkedNames.length ? linkedNames.join(" · ") : t("onboarding.done.noAccounts"),
                    ok: linkedNames.length > 0,
                  }] : []),
                  {
                    label: t("onboarding.done.vehicles"),
                    value: defaultVehicle ? t("onboarding.done.defaultVehicle", { vehicle: defaultVehicle.name }) : vehicles.length ? t("onboarding.done.vehicleCount", { count: vehicles.length }) : t("onboarding.done.noVehicles"),
                    ok: vehicles.length > 0 || ownVehicles.length > 0,
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
