import { useI18n } from "../i18n/I18nProvider.jsx";

// Gemeinsames Layout für Anmeldung und Passwort-Reset: Markenfläche links,
// Formular rechts; auf schmalen Bildschirmen untereinander.
export default function AuthLayout({ children }) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col bg-fb-surface text-fb-text lg:flex-row">
      <section className="relative flex flex-col justify-between gap-10 overflow-hidden bg-[#0c4a6e] px-6 py-8 text-sky-50 sm:px-10 lg:w-1/2 lg:p-14">
        <svg aria-hidden="true" viewBox="0 0 640 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full opacity-55">
          <g fill="none" stroke="#0e5c86" strokeWidth="2">
            <path d="M-20 120 C 140 160, 220 80, 380 140 S 600 260, 700 220" />
            <path d="M-20 330 C 120 300, 260 380, 420 330 S 600 300, 700 360" />
            <path d="M-20 560 C 160 520, 300 620, 460 560 S 620 520, 700 600" />
            <path d="M120 -20 C 160 200, 80 420, 160 620 S 220 820, 180 940" />
            <path d="M420 -20 C 380 180, 470 360, 410 560 S 380 800, 440 940" />
          </g>
          <path d="M160 620 C 220 520, 300 470, 410 430 S 520 300, 560 220" fill="none" stroke="#38bdf8" strokeWidth="5" strokeLinecap="round" />
          <circle cx="160" cy="620" r="9" fill="#38bdf8" stroke="#0c4a6e" strokeWidth="4" />
          <circle cx="560" cy="220" r="9" fill="#f0f9ff" stroke="#38bdf8" strokeWidth="4" />
        </svg>

        <div className="relative flex items-center gap-3 text-xl font-bold">
          <img src="/fahrtenbuch-logo.svg" alt="" className="size-10 rounded-xl object-cover" />
          Fahrtenbuch
        </div>

        <div className="relative hidden max-w-md sm:block">
          <h2 className="text-3xl font-bold leading-tight tracking-tight lg:text-4xl">{t("login.brandTitle")}</h2>
          <p className="mt-4 text-base leading-relaxed text-sky-200">{t("login.brandText")}</p>
        </div>

        <div className="relative hidden text-sm text-sky-300 lg:block">{t("login.brandFooter")}</div>
      </section>

      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </div>
  );
}

export const authInputClass =
  "mt-1.5 block h-11 w-full rounded-lg border border-fb-border bg-fb-main px-3.5 text-base text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent/30 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm";

export const authPrimaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent disabled:cursor-not-allowed disabled:opacity-60";
