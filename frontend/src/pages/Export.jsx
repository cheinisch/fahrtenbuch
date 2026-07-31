import {
  ArrowDownTrayIcon,
  DocumentChartBarIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";

import {
  downloadExport,
  getExportSummary,
  getVehicles,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

const fieldClass = "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

function yearStart() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function km(value) {
  return Number(value || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

function saveBlob({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ExportPage() {
  const { accessToken } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [filters, setFilters] = useState({ from: yearStart(), to: today(), vehicleId: "", type: "" });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");

  const query = useMemo(() => ({ ...filters }), [filters]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [vehicleResult, summaryResult] = await Promise.all([
        getVehicles(accessToken),
        getExportSummary(accessToken, query),
      ]);
      setVehicles(vehicleResult);
      setSummary(summaryResult.summary);
    } catch (loadError) {
      setError(loadError.message || "Die Exportdaten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [accessToken, query]);

  async function download(format) {
    setDownloading(format);
    setError("");
    try {
      saveBlob(await downloadExport(accessToken, format, filters));
    } catch (downloadError) {
      setError(downloadError.message || "Der Export ist fehlgeschlagen.");
    } finally {
      setDownloading("");
    }
  }

  return (
    <div className="space-y-7">
      <header><p className="text-sm font-semibold text-fb-accent">Export</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Statistik und Fahrtenbuch exportieren</h1><p className="mt-2 text-fb-muted">Erstelle einen gefilterten PDF-Bericht oder eine CSV-Datei für weitere Auswertungen.</p></header>
      {error && <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>}

      <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold">Zeitraum und Filter</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-medium">Von<input type="date" value={filters.from} onChange={(e) => setFilters((current) => ({ ...current, from: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-medium">Bis<input type="date" value={filters.to} onChange={(e) => setFilters((current) => ({ ...current, to: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-medium">Fahrzeug<select value={filters.vehicleId} onChange={(e) => setFilters((current) => ({ ...current, vehicleId: e.target.value }))} className={fieldClass}><option value="">Alle Fahrzeuge</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}{vehicle.licensePlate ? ` (${vehicle.licensePlate})` : ""}</option>)}</select></label>
          <label className="text-sm font-medium">Fahrtenart<select value={filters.type} onChange={(e) => setFilters((current) => ({ ...current, type: e.target.value }))} className={fieldClass}><option value="">Alle Arten</option><option value="business">Dienstlich</option><option value="commute">Arbeitsweg</option><option value="private">Privat</option><option value="unclassified">Nicht zugeordnet</option></select></label>
        </div>
      </section>

      {loading || !summary ? <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">Statistik wird berechnet …</div> : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-fb-border bg-fb-main p-5"><div className="text-sm text-fb-muted">Fahrten</div><div className="mt-2 text-3xl font-bold">{summary.tripCount}</div></div><div className="rounded-xl border border-fb-border bg-fb-main p-5"><div className="text-sm text-fb-muted">Gesamtstrecke</div><div className="mt-2 text-3xl font-bold">{km(summary.distanceKm)} km</div></div><div className="rounded-xl border border-fb-border bg-fb-main p-5"><div className="text-sm text-fb-muted">Ohne Kilometerstände</div><div className="mt-2 text-3xl font-bold">{summary.missingOdometerCount}</div></div><div className="rounded-xl border border-fb-border bg-fb-main p-5"><div className="text-sm text-fb-muted">Mit Änderungen</div><div className="mt-2 text-3xl font-bold">{summary.changedTripCount}</div></div></section>

          {(summary.missingOdometerCount > 0 || summary.missingPurposeCount > 0) && <div className="flex gap-3 rounded-xl border border-fb-accent bg-fb-accent-soft p-4"><ExclamationTriangleIcon className="size-6 shrink-0 text-fb-danger" /><div><div className="font-semibold">Vollständigkeit prüfen</div><p className="mt-1 text-sm text-fb-muted">{summary.missingOdometerCount > 0 && `${summary.missingOdometerCount} Fahrt(en) haben keinen vollständigen Start- und Endkilometerstand. `}{summary.missingPurposeCount > 0 && `${summary.missingPurposeCount} dienstliche Fahrt(en) haben keinen Zweck oder Kontakt.`}</p></div></div>}

          <section className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm sm:p-6"><div className="flex items-start gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-fb-accent-soft text-fb-accent"><DocumentChartBarIcon className="size-6" /></span><div><h2 className="text-lg font-bold">Export erstellen</h2><p className="mt-1 text-sm text-fb-muted">Das PDF enthält Zusammenfassung, Fahrtenliste, Kilometerstände und die Anzahl dokumentierter Änderungen.</p></div></div><div className="mt-6 flex flex-col gap-3 sm:flex-row"><button type="button" disabled={Boolean(downloading)} onClick={() => download("pdf")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text hover:bg-fb-accent-secondary disabled:opacity-60"><ArrowDownTrayIcon className="size-5" />{downloading === "pdf" ? "PDF wird erstellt …" : "PDF für das Finanzamt"}</button><button type="button" disabled={Boolean(downloading)} onClick={() => download("csv")} className="inline-flex items-center justify-center gap-2 rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent disabled:opacity-60"><ArrowDownTrayIcon className="size-5" />{downloading === "csv" ? "CSV wird erstellt …" : "CSV exportieren"}</button></div><p className="mt-4 text-xs text-fb-muted">Der Bericht ist steuerlich ausgerichtet. Ob er im konkreten Einzelfall als ordnungsgemäßes Fahrtenbuch anerkannt wird, entscheidet die Finanzverwaltung.</p></section>
        </>
      )}
    </div>
  );
}
