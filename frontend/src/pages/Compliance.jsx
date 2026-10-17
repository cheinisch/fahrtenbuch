import { useEffect, useState } from "react";
import {
  closePeriod,
  getClosedPeriods,
  getComplianceChecks,
  getMonthlyOdometerStatistics,
} from "../api/app.js";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";

// Lokaler Kalendertag; toISOString() würde kurz nach Mitternacht den Vortag liefern.
function dateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDay(value, locale) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return "–";
  return new Intl.DateTimeFormat(locale).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatKm(value, locale) {
  return `${Number(value || 0).toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
}

function StatusTile({ tone, label, value, detail, icon }) {
  const tones = {
    danger: "border-fb-danger/40 [&_.tile-icon]:bg-fb-danger/10 [&_.tile-icon]:text-fb-danger",
    warning: "border-amber-500/50 [&_.tile-icon]:bg-amber-500/10 [&_.tile-icon]:text-amber-700 dark:[&_.tile-icon]:text-amber-400",
    ok: "border-emerald-600/40 [&_.tile-icon]:bg-emerald-600/10 [&_.tile-icon]:text-emerald-700 dark:[&_.tile-icon]:text-emerald-400",
    neutral: "border-fb-border [&_.tile-icon]:bg-fb-surface [&_.tile-icon]:text-fb-muted",
  };
  return (
    <div className={`flex min-w-0 items-center gap-4 rounded-xl border bg-fb-main p-5 ${tones[tone]}`}>
      <span className="tile-icon flex size-11 shrink-0 items-center justify-center rounded-xl">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <div className="min-w-0">
        <div className="text-sm text-fb-muted">{label}</div>
        <div className="text-2xl font-bold leading-tight">{value}</div>
        {detail && <div className="truncate font-mono text-[11px] text-fb-muted" title={detail}>{detail}</div>}
      </div>
    </div>
  );
}

export default function Compliance() {
  const { accessToken } = useAuth();
  const { t, locale } = useI18n();
  const now = new Date();
  const [checks, setChecks] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(dateValue(now));
  const [label, setLabel] = useState(String(now.getFullYear()));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [severityFilter, setSeverityFilter] = useState("all");

  async function load() {
    const [nextChecks, nextPeriods, nextMonthly] = await Promise.all([
      getComplianceChecks(accessToken),
      getClosedPeriods(accessToken),
      getMonthlyOdometerStatistics(accessToken, 3),
    ]);
    setChecks(nextChecks);
    setPeriods(nextPeriods);
    setMonthly(nextMonthly);
  }

  useEffect(() => {
    load().catch((loadError) => setError(loadError.message));
  }, [accessToken]);

  async function handleClose() {
    if (!window.confirm(t("compliance.closeConfirm", { from: formatDay(from, locale), to: formatDay(to, locale) }))) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await closePeriod(accessToken, { periodStart: from, periodEnd: to, label });
      setMessage(t("compliance.closed"));
      await load();
    } catch (closeError) {
      setError(closeError.message);
    } finally {
      setBusy(false);
    }
  }

  const issues = checks?.issues || [];
  const errorCount = checks?.summary?.errors ?? 0;
  const warningCount = checks?.summary?.warnings ?? 0;
  const visibleIssues = severityFilter === "all" ? issues : issues.filter((issue) => issue.severity === severityFilter);
  // Neueste Monate mit Ablesung zuerst, damit die Kontrolle aktuell bleibt.
  const monthlyRows = monthly
    .filter((row) => row.actualKm != null)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)))
    .slice(0, 6);
  const integrityValid = checks?.summary?.integrityValid;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("nav.compliance")}
        title={t("compliance.title")}
        subtitle={t("compliance.subtitle")}
      />

      {error && <div role="alert" className="rounded-lg border border-fb-danger p-4 text-sm text-fb-danger">{error}</div>}
      {message && <div role="status" className="rounded-lg border border-fb-accent bg-fb-accent-soft p-4 text-sm text-fb-accent">{message}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <StatusTile
          tone={!checks ? "neutral" : errorCount > 0 ? "danger" : "ok"}
          label={t("compliance.errors")}
          value={checks ? errorCount : "…"}
          icon={<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></>}
        />
        <StatusTile
          tone={!checks ? "neutral" : warningCount > 0 ? "warning" : "ok"}
          label={t("compliance.warnings")}
          value={checks ? warningCount : "…"}
          icon={<><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>}
        />
        <StatusTile
          tone={!checks ? "neutral" : integrityValid ? "ok" : "danger"}
          label={t("compliance.chain")}
          value={checks ? (integrityValid ? t("compliance.chainValid") : t("compliance.chainInvalid")) : "…"}
          detail={checks?.integrity?.headHash || t("compliance.noRevisions")}
          icon={<><path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z" />{integrityValid !== false && <path d="M9 12l2 2 4-4" />}</>}
        />
      </div>

      <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{t("compliance.issues")}</h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("compliance.filterIssues")}>
            {[
              ["all", t("compliance.filterAll", { count: issues.length })],
              ["error", t("compliance.filterErrors", { count: errorCount })],
              ["warning", t("compliance.filterWarnings", { count: warningCount })],
            ].map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={severityFilter === value}
                onClick={() => setSeverityFilter(value)}
                className={`min-h-9 rounded-full border px-3 text-sm transition ${severityFilter === value ? "border-fb-accent bg-fb-accent-soft font-semibold text-fb-accent" : "border-fb-border hover:border-fb-accent"}`}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        <ul className="mt-4 divide-y divide-fb-border">
          {visibleIssues.length === 0 ? (
            <li className="py-4 text-sm text-fb-muted">{t("compliance.noIssues")}</li>
          ) : visibleIssues.map((issue, index) => (
            <li key={`${issue.tripId}-${issue.code}-${index}`} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
              <div className="flex min-w-0 flex-[1_1_420px] items-start gap-3">
              <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${issue.severity === "error" ? "bg-fb-danger/10 text-fb-danger" : "bg-amber-500/15 text-amber-800 dark:text-amber-300"}`}>
                {issue.severity === "error" ? t("compliance.severityError") : t("compliance.severityWarning")}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{issue.message}</p>
                <p className="mt-0.5 text-xs text-fb-muted">{issue.startedAt ? new Date(issue.startedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "–"}</p>
              </div>
              </div>
              {issue.tripId && <Link to={`/?trip=${encodeURIComponent(issue.tripId)}`} className="py-2.5 text-[13px] font-semibold text-fb-accent-strong hover:underline">{t("compliance.openTrip")}</Link>}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
        <h2 className="text-lg font-bold">{t("compliance.monthlyTitle")}</h2>
        <p className="mt-1 text-sm text-fb-muted">{t("compliance.monthlyHint")}</p>
        {monthlyRows.length === 0 ? (
          <p className="mt-4 text-sm text-fb-muted">{t("compliance.monthlyEmpty")}</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {monthlyRows.map((row) => {
              const coverage = row.actualKm > 0 ? Math.min(100, Math.max(0, (row.trackedKm || 0) / row.actualKm * 100)) : 100;
              const good = coverage >= 95;
              return (
                <div key={`${row.vehicleId}-${row.month}`} className="rounded-lg border border-fb-border bg-fb-surface p-4 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{row.vehicleName} · {row.month}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${good ? "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-300"}`}>
                      {coverage.toLocaleString(locale, { maximumFractionDigits: 0 })} %
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-fb-muted">
                    <span>{t("compliance.odometer")} <strong className="text-fb-text">{formatKm(row.actualKm, locale)}</strong></span>
                    <span>{t("compliance.tracked")} <strong className="text-fb-text">{formatKm(row.trackedKm, locale)}</strong></span>
                    <span>{t("compliance.unknown")} <strong className="text-fb-text">{formatKm(row.unknownKm, locale)}</strong></span>
                  </div>
                  <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-fb-border">
                    <div className={`h-full rounded-full ${good ? "bg-emerald-600" : "bg-amber-500"}`} style={{ width: `${coverage}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
        <h2 className="text-lg font-bold">{t("compliance.closeTitle")}</h2>
        <p className="mt-1 text-sm text-fb-muted">
          {t("compliance.closeHint")}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
          <label className="text-sm font-medium">{t("exportPage.from")}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-fb-border bg-fb-surface px-3" /></label>
          <label className="text-sm font-medium">{t("exportPage.to")}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-fb-border bg-fb-surface px-3" /></label>
          <label className="text-sm font-medium">{t("compliance.label")}<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className="mt-1.5 h-11 w-full rounded-lg border border-fb-border bg-fb-surface px-3" /></label>
          <button type="button" disabled={busy || !checks?.summary?.integrityValid} onClick={handleClose} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text disabled:opacity-50">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            {busy ? t("compliance.closing") : t("compliance.closeTitle")}
          </button>
        </div>
        {checks && !checks.summary?.integrityValid && (
          <p className="mt-2 text-xs text-fb-danger">{t("compliance.chainBlocks")}</p>
        )}

        {periods.length > 0 && (
          <ul className="mt-6 divide-y divide-fb-border border-t border-fb-border">
            {periods.map((period) => (
              <li key={period.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <div className="font-semibold">{period.label || t("compliance.closedPeriod")}</div>
                  <div className="mt-0.5 text-fb-muted">{formatDay(period.periodStart, locale)} – {formatDay(period.periodEnd, locale)}</div>
                </div>
                <span className="text-fb-muted">{t("compliance.closedAt", { date: new Date(period.closedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
