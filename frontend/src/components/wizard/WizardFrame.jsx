import { CheckIcon } from "@heroicons/react/20/solid";
import { ArrowLeftIcon, ArrowRightOnRectangleIcon } from "@heroicons/react/24/outline";

import { useI18n } from "../../i18n/I18nProvider.jsx";
import { withBasePath } from "../../lib/basePath.js";

// Gemeinsamer Rahmen der Einrichtungsassistenten: Kopfzeile mit Fortschritt,
// Schrittliste (links bzw. oben auf dem Handy), Karte mit Inhalt und Fußleiste.

export const wizardFieldClass =
  "mt-1.5 block h-11 w-full rounded-lg border border-fb-border bg-fb-main px-3.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent/30 disabled:cursor-not-allowed disabled:opacity-60";

export const wizardPrimaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-fb-accent px-5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent disabled:cursor-not-allowed disabled:opacity-60";

export const wizardSecondaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-fb-border bg-fb-main px-4 text-sm font-semibold text-fb-text transition hover:border-fb-accent disabled:cursor-not-allowed disabled:opacity-60";

export function WizardStepHeader({ eyebrow, title, subtitle, optional }) {
  const { t } = useI18n();

  return (
    <div className="space-y-2">
      {eyebrow && <p className="text-sm font-semibold text-fb-accent-strong">{eyebrow}</p>}
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[26px]">{title}</h1>
        {optional && (
          <span className="rounded-full bg-fb-surface px-2.5 py-0.5 text-xs font-semibold text-fb-muted ring-1 ring-fb-border">
            {t("wizard.optional")}
          </span>
        )}
      </div>
      {subtitle && <p className="max-w-2xl text-[15px] leading-relaxed text-fb-muted">{subtitle}</p>}
    </div>
  );
}

/** Hinweisbox: tone info | warn | success | danger */
export function WizardNotice({ tone = "info", icon: Icon, children }) {
  const tones = {
    info: "bg-fb-surface text-fb-text ring-fb-border",
    warn: "bg-fb-warn-soft text-fb-warn ring-transparent",
    success: "bg-fb-accent-soft text-fb-accent-strong ring-transparent",
    danger: "bg-fb-main text-fb-danger ring-fb-danger",
  };

  return (
    <div className={`flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm leading-relaxed ring-1 ${tones[tone]}`}>
      {Icon && <Icon aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Zeile „Status aus der Docker-Umgebung“: Bezeichnung, Wert, ok/warn. */
export function StatusRow({ label, value, ok, hint }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-fb-muted">{hint}</div>}
      </div>
      <div className={`shrink-0 break-all text-sm sm:max-w-[55%] sm:text-right ${ok === false ? "text-fb-warn" : ok ? "text-fb-accent-strong" : "text-fb-muted"}`}>
        {value}
      </div>
    </div>
  );
}

/** Schalter wie in den Einstellungen, als echter Button mit aria-pressed. */
export function WizardToggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-fb-accent" : "bg-fb-border",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "size-6 rounded-full bg-white shadow transition",
          checked ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

/** Auswahl-Chips (Sprache, Einheit …) */
export function ChoiceChips({ label, options, value, onChange }) {
  return (
    <div>
      {label && <div className="text-sm font-medium">{label}</div>}
      <div role="group" aria-label={label} className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={[
                "h-11 rounded-lg px-4 text-sm font-semibold transition",
                active
                  ? "bg-fb-accent-soft text-fb-accent-strong ring-2 ring-fb-accent"
                  : "bg-fb-main text-fb-text ring-1 ring-fb-border hover:ring-fb-accent",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function WizardFrame({
  title,
  steps,
  currentIndex,
  maxReachedIndex,
  onStepSelect,
  onBack,
  onNext,
  onSkip,
  nextLabel,
  nextDisabled,
  busy,
  error,
  onSignOut,
  children,
}) {
  const { t } = useI18n();
  const total = steps.length;
  const progress = Math.round(((currentIndex + 1) / total) * 100);

  return (
    <div className="flex min-h-screen flex-col bg-fb-surface text-fb-text">
      <header className="border-b border-fb-border bg-fb-main">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src={withBasePath("/fahrtenbuch-logo.svg")} alt="" className="size-[34px] rounded-[9px] object-cover" />
            <div className="leading-tight">
              <div className="text-[17px] font-bold">Fahrtenbuch</div>
              <div className="text-xs text-fb-muted">{title}</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-sm text-fb-muted">
              <span>{t("wizard.stepOf", { current: currentIndex + 1, total })}</span>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-label={t("wizard.progress")}
                className="hidden h-1.5 w-36 overflow-hidden rounded-full bg-fb-surface ring-1 ring-fb-border sm:block"
              >
                <div className="h-full rounded-full bg-fb-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-fb-muted hover:text-fb-text"
              >
                <ArrowRightOnRectangleIcon aria-hidden="true" className="size-5" />
                <span className="hidden sm:inline">{t("nav.logout")}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-wrap items-start gap-6 px-4 py-6 sm:px-6 lg:gap-8 lg:py-8">
        <nav aria-label={t("wizard.steps")} className="flex w-full gap-1.5 overflow-x-auto lg:w-64 lg:flex-col lg:overflow-visible">
          {steps.map((step, index) => {
            const current = index === currentIndex;
            const done = !current && index <= maxReachedIndex;
            const reachable = index <= maxReachedIndex;

            return (
              <button
                key={step.id}
                type="button"
                onClick={() => reachable && onStepSelect(index)}
                disabled={!reachable || busy}
                aria-current={current ? "step" : undefined}
                className={[
                  "flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left transition disabled:cursor-default",
                  current ? "bg-fb-accent-soft" : reachable ? "hover:bg-fb-main" : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    current
                      ? "bg-fb-main text-fb-accent-strong ring-2 ring-fb-accent"
                      : done
                        ? "bg-fb-accent text-fb-accent-text"
                        : "text-fb-muted ring-1 ring-fb-border",
                  ].join(" ")}
                >
                  {done ? <CheckIcon aria-hidden="true" className="size-4" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className={`block whitespace-nowrap text-sm ${current ? "font-semibold" : "font-medium"}`}>{step.label}</span>
                  {step.hint && <span className="hidden whitespace-nowrap text-xs text-fb-muted lg:block">{step.hint}</span>}
                </span>
              </button>
            );
          })}
        </nav>

        <main className="flex min-w-0 flex-[999_1_560px] flex-col rounded-xl border border-fb-border bg-fb-main">
          <div className="flex flex-col gap-7 p-5 sm:p-8">
            {children}
            {error && (
              <div role="alert" className="rounded-lg border border-fb-danger px-4 py-3 text-sm text-fb-danger">
                {error}
              </div>
            )}
          </div>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-fb-border px-5 py-4 sm:px-8">
            <div>
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  disabled={busy}
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-fb-muted hover:text-fb-text disabled:opacity-60"
                >
                  <ArrowLeftIcon aria-hidden="true" className="size-4" />
                  {t("wizard.back")}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {onSkip && (
                <button type="button" onClick={onSkip} disabled={busy} className={wizardSecondaryButtonClass}>
                  {t("wizard.skip")}
                </button>
              )}
              <button type="button" onClick={onNext} disabled={busy || nextDisabled} className={wizardPrimaryButtonClass}>
                {busy ? t("common.saving") : nextLabel}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
