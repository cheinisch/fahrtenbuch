import { useEffect, useState } from "react";
import {
  closePeriod,
  getClosedPeriods,
  getComplianceChecks,
  getMonthlyOdometerStatistics,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

function dateValue(date) {
  return date.toISOString().slice(0, 10);
}

export default function Compliance() {
  const { accessToken } = useAuth();
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
    if (!window.confirm(`Zeitraum ${from} bis ${to} endgültig abschließen? Fahrten darin können danach nicht mehr geändert werden.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await closePeriod(accessToken, { periodStart: from, periodEnd: to, label });
      setMessage("Der Zeitraum wurde abgeschlossen und gegen Änderungen gesperrt.");
      await load();
    } catch (closeError) {
      setError(closeError.message);
    } finally {
      setBusy(false);
    }
  }

  const issues = checks?.issues || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prüfung und Abschluss</h1>
        <p className="mt-1 text-sm text-fb-muted">
          Prüfe Fahrten auf Unstimmigkeiten, kontrolliere die Integrität der Revisionen und schließe fertige Zeiträume.
        </p>
      </div>

      {error && <div className="rounded-lg border border-fb-danger p-4 text-sm text-fb-danger">{error}</div>}
      {message && <div className="rounded-lg border border-fb-accent p-4 text-sm">{message}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-fb-border bg-fb-main p-5">
          <div className="text-sm text-fb-muted">Fehler</div>
          <div className="mt-2 text-3xl font-bold">{checks?.summary?.errors ?? "…"}</div>
        </div>
        <div className="rounded-xl border border-fb-border bg-fb-main p-5">
          <div className="text-sm text-fb-muted">Warnungen</div>
          <div className="mt-2 text-3xl font-bold">{checks?.summary?.warnings ?? "…"}</div>
        </div>
        <div className="rounded-xl border border-fb-border bg-fb-main p-5">
          <div className="text-sm text-fb-muted">Revisionskette</div>
          <div className="mt-2 text-lg font-bold">
            {checks ? (checks.summary.integrityValid ? "Integer" : "Fehlerhaft") : "…"}
          </div>
          <div className="mt-1 break-all text-xs text-fb-muted">
            {checks?.integrity?.headHash || "Noch keine Revisionen"}
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-fb-border bg-fb-main p-5">
        <h2 className="text-lg font-bold">Auffälligkeiten</h2>
        <div className="mt-4 divide-y divide-fb-border">
          {issues.length === 0 ? (
            <p className="py-4 text-sm text-fb-muted">Keine Auffälligkeiten gefunden.</p>
          ) : issues.map((issue, index) => (
            <div key={`${issue.tripId}-${issue.code}-${index}`} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{issue.severity === "error" ? "Fehler" : "Warnung"}</span>
                <span className="text-xs text-fb-muted">{new Date(issue.startedAt).toLocaleString("de-DE")}</span>
              </div>
              <p className="mt-1 text-sm">{issue.message}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-fb-border bg-fb-main p-5">
        <h2 className="text-lg font-bold">Monatskontrolle</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {monthly.filter((row)=>row.actualKm != null).slice(0,4).map((row)=>(
            <div key={`${row.vehicleId}-${row.month}`} className="rounded-lg border border-fb-border bg-fb-surface p-4 text-sm">
              <div className="font-semibold">{row.vehicleName} · {row.month}</div>
              <div className="mt-2 text-fb-muted">
                Tacho {row.actualKm.toLocaleString("de-DE")} km · erfasst {row.trackedKm.toLocaleString("de-DE")} km · unbekannt {(row.unknownKm || 0).toLocaleString("de-DE")} km
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-fb-border bg-fb-main p-5">
        <h2 className="text-lg font-bold">Zeitraum abschließen</h2>
        <p className="mt-1 text-sm text-fb-muted">
          Ein Abschluss ist dauerhaft. Fahrten und Tags im Zeitraum werden anschließend auf Datenbankebene gegen Änderungen gesperrt.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-sm">Von<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-2 w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2" /></label>
          <label className="text-sm">Bis<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-2 w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2" /></label>
          <label className="text-sm">Bezeichnung<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className="mt-2 w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2" /></label>
          <button type="button" disabled={busy || !checks?.summary?.integrityValid} onClick={handleClose} className="self-end rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">
            {busy ? "Schließe …" : "Zeitraum abschließen"}
          </button>
        </div>

        <div className="mt-6 divide-y divide-fb-border">
          {periods.map((period) => (
            <div key={period.id} className="py-3 text-sm">
              <div className="font-semibold">{period.label || "Abgeschlossener Zeitraum"}</div>
              <div className="mt-1 text-fb-muted">{String(period.periodStart).slice(0,10)} – {String(period.periodEnd).slice(0,10)} · abgeschlossen {new Date(period.closedAt).toLocaleString("de-DE")}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
