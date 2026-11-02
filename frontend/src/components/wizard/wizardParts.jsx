import { CheckCircleIcon, DevicePhoneMobileIcon, MinusCircleIcon } from "@heroicons/react/24/outline";
import { useCallback, useState } from "react";

import { useI18n } from "../../i18n/I18nProvider.jsx";
import AddNewDeviceModal from "../addNewDeviceModal.jsx";
import { wizardFieldClass, wizardSecondaryButtonClass } from "./WizardFrame.jsx";
import { currentAppUrl } from "../../lib/basePath.js";

/**
 * Schrittsteuerung mit Merker in sessionStorage, damit ein Neuladen (oder die
 * Rückkehr vom OAuth-Anbieter) nicht wieder bei Schritt 1 beginnt.
 */
export function useWizardNavigation(storageKey, stepIds, initialId = null) {
  const read = () => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  };
  const [state, setState] = useState(() => {
    const stored = read();
    const forced = initialId ? stepIds.indexOf(initialId) : -1;
    const index = forced >= 0 ? forced : Math.min(Math.max(stored?.index ?? 0, 0), stepIds.length - 1);
    return { index, maxReached: Math.max(index, Math.min(stored?.maxReached ?? 0, stepIds.length - 1)) };
  });

  const goTo = useCallback((index) => {
    setState((current) => {
      const next = { index, maxReached: Math.max(current.maxReached, index) };
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* privater Modus */ }
      return next;
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [storageKey]);

  const clear = useCallback(() => {
    try { sessionStorage.removeItem(storageKey); } catch { /* egal */ }
  }, [storageKey]);

  const index = Math.min(state.index, stepIds.length - 1);
  return { index, stepId: stepIds[index], maxReached: Math.min(state.maxReached, stepIds.length - 1), goTo, clear };
}

/** Passwortfelder (aktuelles/vorläufiges, neues, Wiederholung) mit gemeinsamer Prüfung. */
export function PasswordFields({ value, onChange, currentLabel, required }) {
  const { t } = useI18n();
  const update = (name) => (event) => onChange({ ...value, [name]: event.target.value });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
        {currentLabel}
        <input type="password" autoComplete="current-password" className={wizardFieldClass} value={value.current} onChange={update("current")} required={required} />
      </label>
      <label className="block text-sm font-medium">
        {t("wizard.password.new")}
        <input type="password" autoComplete="new-password" className={wizardFieldClass} value={value.next} onChange={update("next")} required={required} />
        <span className="mt-1 block text-xs text-fb-muted">{t("wizard.password.hint")}</span>
      </label>
      <label className="block text-sm font-medium">
        {t("wizard.password.repeat")}
        <input type="password" autoComplete="new-password" className={wizardFieldClass} value={value.repeat} onChange={update("repeat")} required={required} />
      </label>
    </div>
  );
}

export const emptyPasswords = { current: "", next: "", repeat: "" };

/** Gibt einen Fehlertext zurück oder null. `required`: alle Felder Pflicht. */
export function validatePasswords(passwords, required, t) {
  const any = passwords.current || passwords.next || passwords.repeat;
  if (!required && !any) return null;
  if (!passwords.current) return t("wizard.password.currentMissing");
  if (passwords.next.length < 8) return t("wizard.password.tooShort");
  if (passwords.next !== passwords.repeat) return t("wizard.password.mismatch");
  if (passwords.next === passwords.current) return t("wizard.password.unchanged");
  return null;
}

/** Zusammenfassung am Ende: Zeilen mit Haken bzw. „übersprungen“. */
export function SummaryList({ rows }) {
  return (
    <ul className="divide-y divide-fb-border rounded-xl border border-fb-border">
      {rows.map((row) => (
        <li key={row.label} className="flex items-start justify-between gap-4 px-4 py-3">
          <span className="text-sm font-medium">{row.label}</span>
          <span className={`flex items-center gap-1.5 text-right text-sm ${row.ok ? "text-fb-accent-strong" : "text-fb-muted"}`}>
            {row.ok
              ? <CheckCircleIcon aria-hidden="true" className="size-4 shrink-0" />
              : <MinusCircleIcon aria-hidden="true" className="size-4 shrink-0" />}
            {row.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Android-App verbinden: Serveradresse plus die bekannte Kopplung per QR-Code. */
export function ConnectAppCard() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [paired, setPaired] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-fb-border p-5">
      <div className="flex items-center gap-2.5">
        <DevicePhoneMobileIcon aria-hidden="true" className="size-6 text-fb-accent-strong" />
        <h2 className="text-base font-bold">{t("wizard.app.title")}</h2>
      </div>
      <p className="text-sm leading-relaxed text-fb-muted">{t("wizard.app.text")}</p>
      <div className="rounded-lg bg-fb-surface px-3 py-2 font-mono text-sm break-all">{currentAppUrl()}</div>
      {paired ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-fb-accent-strong">
          <CheckCircleIcon aria-hidden="true" className="size-5" />
          {t("wizard.app.paired")}
        </p>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`${wizardSecondaryButtonClass} self-start`}>
          {t("wizard.app.pair")}
        </button>
      )}
      <AddNewDeviceModal open={open} onClose={() => setOpen(false)} onPaired={() => setPaired(true)} />
    </div>
  );
}
