import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import {
  deleteAdminMailSettings,
  getAdminMailSettings,
  saveAdminMailSettings,
  sendAdminTestMail,
} from "../../api/app.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { WizardNotice, wizardFieldClass, wizardSecondaryButtonClass, wizardPrimaryButtonClass } from "../wizard/WizardFrame.jsx";

function formFrom(settings) {
  return {
    host: settings?.host || "",
    port: String(settings?.port || 587),
    security: settings?.security || "starttls",
    username: settings?.username || "",
    password: "",
    fromAddress: settings?.fromAddress || "",
    fromName: settings?.fromName || "",
  };
}

function payloadFrom(form) {
  return {
    host: form.host.trim(),
    port: Number(form.port) || 587,
    security: form.security,
    username: form.username.trim() || null,
    // Leer = gespeichertes Passwort behalten
    password: form.password || null,
    fromAddress: form.fromAddress.trim(),
    fromName: form.fromName.trim() || null,
  };
}

/**
 * SMTP-Einstellungen (Systemeinstellungen und Einrichtungsassistent).
 * `save()` per Ref, damit der Assistent beim „Weiter“ speichern kann; `standalone`
 * zeigt zusätzlich eigene Speichern-/Entfernen-Buttons.
 */
const MailSettingsForm = forwardRef(function MailSettingsForm({ standalone = false, onChange }, ref) {
  const { accessToken, user } = useAuth();
  const { t } = useI18n();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(formFrom(null));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAdminMailSettings(accessToken)
      .then((result) => {
        if (!active) return;
        setSettings(result);
        setForm(formFrom(result));
      })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [accessToken]);

  useEffect(() => { onChange?.(settings); }, [settings]);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setDirty(true);
    setMessage("");
  }

  const filled = Boolean(form.host.trim());

  async function save() {
    // Nichts eingetragen: im Assistenten einfach weiter, nichts speichern
    if (!filled) return settings;
    if (!form.fromAddress.trim()) {
      const missing = new Error(t("mailSettings.fromRequired"));
      setError(missing.message);
      throw missing;
    }
    if (!dirty && settings?.source === "database") return settings;
    setBusy("save");
    setError("");
    try {
      const result = await saveAdminMailSettings(accessToken, payloadFrom(form));
      setSettings(result);
      setForm(formFrom(result));
      setDirty(false);
      setMessage(t("mailSettings.saved"));
      return result;
    } catch (saveError) {
      setError(saveError.message);
      throw saveError;
    } finally {
      setBusy("");
    }
  }

  useImperativeHandle(ref, () => ({ save, filled, dirty }), [form, dirty, settings, filled]);

  async function sendTest() {
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const result = await sendAdminTestMail(accessToken, { settings: payloadFrom(form) });
      setMessage(t("mailSettings.testSent", { email: result.to }));
    } catch (testError) {
      setError(testError.message);
    } finally {
      setBusy("");
    }
  }

  async function removeStored() {
    setBusy("delete");
    setError("");
    try {
      const result = await deleteAdminMailSettings(accessToken);
      setSettings(result);
      setForm(formFrom(result));
      setDirty(false);
      setMessage(t("mailSettings.removed"));
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy("");
    }
  }

  if (!settings && !error) {
    return <div className="text-sm text-fb-muted">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-5">
      {settings?.source === "environment" && (
        <WizardNotice tone="info" icon={InformationCircleIcon}>
          {t("mailSettings.fromEnvironment")}
        </WizardNotice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t("mailSettings.host")}
          <input className={wizardFieldClass} value={form.host} onChange={(event) => update("host", event.target.value)} placeholder="smtp.example.de" autoComplete="off" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            {t("mailSettings.port")}
            <input className={wizardFieldClass} inputMode="numeric" value={form.port} onChange={(event) => update("port", event.target.value.replace(/[^0-9]/g, ""))} />
          </label>
          <label className="block text-sm font-medium">
            {t("mailSettings.security")}
            <select className={wizardFieldClass} value={form.security} onChange={(event) => update("security", event.target.value)}>
              <option value="starttls">STARTTLS</option>
              <option value="tls">SSL/TLS</option>
              <option value="none">{t("mailSettings.securityNone")}</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium">
          {t("mailSettings.username")}
          <input className={wizardFieldClass} value={form.username} onChange={(event) => update("username", event.target.value)} autoComplete="off" />
        </label>
        <label className="block text-sm font-medium">
          {t("mailSettings.password")}
          <input
            type="password"
            className={wizardFieldClass}
            value={form.password}
            onChange={(event) => update("password", event.target.value)}
            placeholder={settings?.passwordSet ? t("mailSettings.passwordUnchanged") : ""}
            autoComplete="new-password"
          />
        </label>
        <label className="block text-sm font-medium">
          {t("mailSettings.fromAddress")}
          <input type="email" className={wizardFieldClass} value={form.fromAddress} onChange={(event) => update("fromAddress", event.target.value)} placeholder="fahrtenbuch@example.de" />
        </label>
        <label className="block text-sm font-medium">
          {t("mailSettings.fromName")}
          <input className={wizardFieldClass} value={form.fromName} onChange={(event) => update("fromName", event.target.value)} placeholder="Fahrtenbuch" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={sendTest} disabled={!filled || !form.fromAddress.trim() || Boolean(busy)} className={wizardSecondaryButtonClass}>
          {busy === "test" ? t("mailSettings.testSending") : t("mailSettings.test")}
        </button>
        <span className="text-xs text-fb-muted">{t("mailSettings.testHint", { email: user?.email || "" })}</span>
      </div>

      {message && (
        <WizardNotice tone="success" icon={CheckCircleIcon}>{message}</WizardNotice>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>
      )}

      {!settings?.configured && !filled && (
        <WizardNotice tone="warn" icon={ExclamationTriangleIcon}>{t("mailSettings.withoutSmtp")}</WizardNotice>
      )}

      {standalone && (
        <div className="flex flex-wrap justify-end gap-3 border-t border-fb-border pt-5">
          {settings?.source === "database" && (
            <button type="button" onClick={removeStored} disabled={Boolean(busy)} className={`${wizardSecondaryButtonClass} text-fb-danger`}>
              {busy === "delete" ? t("common.saving") : t("mailSettings.remove")}
            </button>
          )}
          <button type="button" onClick={() => save().catch(() => {})} disabled={!filled || Boolean(busy)} className={wizardPrimaryButtonClass}>
            {busy === "save" ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
});

export default MailSettingsForm;
