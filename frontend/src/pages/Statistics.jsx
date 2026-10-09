import { useEffect, useMemo, useState } from "react";

import { getMonthlyOdometerStatistics, getOdometerIntervalStatistics, getOdometerReadings, getVehicles, saveMonthlyOdometerReading } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import OdometerReadingLogModal from "../components/OdometerReadingLogModal.jsx";

const labels = {
  businessKm: "Beruflich",
  privateKm: "Privat",
  commuteKm: "Arbeitsweg",
  unclassifiedKm: "Nicht zugeordnet",
  unknownKm: "Unbekannt / nicht erfasst",
};

function km(value) {
  if (value == null) return "–";
  return `${Number(value).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`;
}

function monthLabel(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value || ""));
  if (!match) return "–";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return "–";
  const date = new Date(year, month - 1, 1);
  if (!Number.isFinite(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}


function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultChartRange() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - 3, to.getDate());
  return { from: isoDate(from), to: isoDate(to) };
}

function intervalMonthKey(endDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(endDate || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function StatisticsChart({ data }) {
  const width = 900;
  const height = 280;
  const pad = { left: 56, right: 20, top: 24, bottom: 44 };
  const max = Math.max(1, ...data.flatMap((item) => [item.actualKm, item.trackedKm]));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const groupW = data.length ? innerW / data.length : innerW;
  const barW = Math.min(28, groupW * 0.28);
  const y = (value) => pad.top + innerH - (Math.max(0, value) / max) * innerH;

  return (
    <div className="mt-5 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[720px] w-full" role="img" aria-label="Kilometerstatistik im ausgewählten Zeitraum">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const yy = pad.top + innerH - ratio * innerH;
          return <g key={ratio}><line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="stroke-fb-border" /><text x={pad.left - 8} y={yy + 4} textAnchor="end" className="fill-fb-muted text-[11px]">{Math.round(max * ratio).toLocaleString("de-DE")}</text></g>;
        })}
        {data.map((item, index) => {
          const center = pad.left + groupW * index + groupW / 2;
          const actualY = y(item.actualKm);
          const trackedY = y(item.trackedKm);
          return <g key={item.label}>
            <rect x={center - barW - 2} y={actualY} width={barW} height={pad.top + innerH - actualY} rx="3" className="fill-fb-accent" />
            <rect x={center + 2} y={trackedY} width={barW} height={pad.top + innerH - trackedY} rx="3" className="fill-fb-muted opacity-70" />
            <text x={center} y={height - 16} textAnchor="middle" className="fill-fb-muted text-[11px]">{item.label}</text>
          </g>;
        })}
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-5 text-xs text-fb-muted">
        <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-fb-accent" />Tatsächlich laut Ablesungen</span>
        <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-fb-muted opacity-70" />Erfasste Fahrten</span>
      </div>
    </div>
  );
}

export default function Statistics() {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState([]);
  const [vehicleId, setVehicleId] = useState("");
  const [month, setMonth] = useState("");
  const [error, setError] = useState("");
  const [readings, setReadings] = useState([]);
  const [vehicleDetails, setVehicleDetails] = useState([]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryKm, setEntryKm] = useState("");
  const [savingReading, setSavingReading] = useState(false);
  const [message, setMessage] = useState("");
  const [intervals, setIntervals] = useState([]);
  const [readingLogOpen, setReadingLogOpen] = useState(false);
  const [intervalModalOpen, setIntervalModalOpen] = useState(false);
  const [chartYear, setChartYear] = useState(String(new Date().getFullYear()));

  async function loadData() {
    try {
      const [result, readingRows, vehicleRows] = await Promise.all([
        getMonthlyOdometerStatistics(accessToken, 18),
        getOdometerReadings(accessToken),
        getVehicles(accessToken),
      ]);
      setRows(result);
      setReadings(readingRows);
      setVehicleDetails(vehicleRows);
      if (!vehicleId) {
        const firstVehicleId = readingRows[0]?.vehicleId || result[0]?.vehicleId || "";
        if (firstVehicleId) {
          setVehicleId(firstVehicleId);
          const newestMonth = result.find((row) => row.vehicleId === firstVehicleId)?.month;
          if (newestMonth) setMonth(newestMonth);
        }
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    loadData();
  }, [accessToken]);

  useEffect(() => {
    if (!vehicleId) {
      setIntervals([]);
      return;
    }
    getOdometerIntervalStatistics(accessToken, vehicleId, `${chartYear}-01-01`, `${Number(chartYear) + 1}-01-01`)
      .then(setIntervals)
      .catch((loadError) => setError(loadError.message));
  }, [accessToken, vehicleId, readings, chartYear]);

  async function saveReading(event) {
    event.preventDefault();
    if (!vehicleId) {
      setError("Bitte ein Fahrzeug auswählen.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      setError("Bitte ein gültiges Ablesedatum auswählen.");
      return;
    }
    const entryMonth = entryDate.slice(0, 7);
    const value = Number(String(entryKm).replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      setError("Bitte einen gültigen Kilometerstand eingeben.");
      return;
    }
    setSavingReading(true);
    setError("");
    setMessage("");
    try {
      await saveMonthlyOdometerReading(accessToken, vehicleId, entryMonth, value, entryDate);
      setMessage(`Kilometerstand vom ${new Intl.DateTimeFormat("de-DE").format(new Date(`${entryDate}T00:00:00`))} wurde gespeichert.`);
      setEntryKm("");
      await loadData();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingReading(false);
    }
  }

  const vehicles = useMemo(() => {
    const vehicleNames = new Map(rows.map((row) => [row.vehicleId, row.vehicleName]));
    return Array.from(new Set([...rows.map((row) => row.vehicleId), ...readings.map((reading) => reading.vehicleId)]))
      .map((id) => [id, vehicleNames.get(id) || readings.find((reading) => reading.vehicleId === id)?.vehicleName || "Fahrzeug"])
      .filter(([, name]) => Boolean(name));
  }, [rows, readings]);

  // Monthly statistics already include the current month, even without an odometer reading.
  const availableMonths = useMemo(() => Array.from(new Set(
    rows
      .filter((row) => row.vehicleId === vehicleId)
      .map((row) => row.month)
      .filter((value) => /^\d{4}-\d{2}$/.test(value)),
  )).sort().reverse(), [rows, vehicleId]);

  const availableYears = useMemo(() => Array.from(new Set(
    availableMonths.map((value) => value.slice(0, 4)),
  )), [availableMonths]);

  const selectedYear = month ? month.slice(0, 4) : (availableYears[0] || "");
  const monthsForYear = useMemo(
    () => availableMonths.filter((value) => value.startsWith(`${selectedYear}-`)),
    [availableMonths, selectedYear],
  );

  const chartYears = useMemo(() => Array.from(new Set(
    readings.filter((reading) => reading.vehicleId === vehicleId)
      .map((reading) => (reading.readingDate || `${reading.month}-01`).slice(0, 4))
      .filter((year) => /^\d{4}$/.test(year)),
  )).sort().reverse(), [readings, vehicleId]);

  useEffect(() => {
    if (chartYears.length && !chartYears.includes(chartYear)) setChartYear(chartYears[0]);
  }, [chartYears, chartYear]);

  const chartData = useMemo(() => {
    const buckets = new Map();
    intervals.forEach((item) => {
      const key = intervalMonthKey(item.endDate);
      if (!key.startsWith(`${chartYear}-`)) return;
      const current = buckets.get(key) || { actualKm: 0, trackedKm: 0 };
      current.actualKm += item.actualKm;
      current.trackedKm += item.trackedKm;
      buckets.set(key, current);
    });
    return Array.from({ length: 12 }, (_, index) => {
      const key = `${chartYear}-${String(index + 1).padStart(2, "0")}`;
      const value = buckets.get(key);
      return value ? { label: monthLabel(key).replace(/\s+\d{4}$/, ""), ...value } : null;
    }).filter(Boolean);
  }, [intervals, chartYear]);

  const leasing = useMemo(() => {
    const vehicle = vehicleDetails.find((item) => item.id === vehicleId);
    if (!vehicle || vehicle.acquisitionType === "owned" || !vehicle.leaseStartDate || !vehicle.leaseEndDate || !vehicle.leaseIncludedKm) return null;
    const vehicleReadings = readings.filter((reading) => reading.vehicleId === vehicleId)
      .map((reading) => ({ ...reading, date: new Date(`${reading.readingDate || `${reading.month}-01`}T00:00:00`) }))
      .filter((reading) => Number.isFinite(reading.date.getTime()))
      .sort((a, b) => a.date - b.date);
    if (!vehicleReadings.length) return null;
    const start = new Date(`${vehicle.leaseStartDate.slice(0, 10)}T00:00:00`);
    const end = new Date(`${vehicle.leaseEndDate.slice(0, 10)}T00:00:00`);
    const first = vehicleReadings.find((reading) => reading.date >= start) || vehicleReadings[0];
    const last = [...vehicleReadings].reverse().find((reading) => reading.date <= end) || vehicleReadings.at(-1);
    const totalDays = Math.max(1, (end - start) / 86400000);
    const elapsedDays = Math.max(0, Math.min(totalDays, (last.date - start) / 86400000));
    const drivenKm = Math.max(0, Number(last.odometerKm) - Number(first.odometerKm));
    const allowedKm = vehicle.leaseIncludedKm * elapsedDays / totalDays;
    const projectedKm = elapsedDays > 0 ? drivenKm / elapsedDays * totalDays : 0;
    return { vehicle, drivenKm, allowedKm, projectedKm, deviationKm: projectedKm - vehicle.leaseIncludedKm, elapsedPercent: elapsedDays / totalDays * 100 };
  }, [vehicleDetails, readings, vehicleId]);

  const selected = rows.find((row) => row.vehicleId === vehicleId && row.month === month) || null;
  // Use recorded trip kilometres as the live baseline until the odometer readings
  // cover the whole month. A zero-km reading interval must not hide recorded trips.
  const total = selected ? Math.max(
    0,
    Number(selected.actualKm) || 0,
    Number(selected.trackedKm) || 0,
  ) : 0;
  const parts = selected ? [
    ["businessKm", selected.businessKm],
    ["privateKm", selected.privateKm],
    ["commuteKm", selected.commuteKm],
    ["unclassifiedKm", selected.unclassifiedKm],
    ["unknownKm", selected.unknownKm],
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Statistik</h1>
        <p className="mt-1 text-sm text-fb-muted">
          Monatsauswertung aus aufgezeichneten Fahrten und den manuellen Kilometerständen des Fahrzeugs.
        </p>
      </div>
      {error && <div className="rounded-lg border border-fb-danger p-4 text-sm text-fb-danger">{error}</div>}
      {message && <div className="rounded-lg border border-fb-accent bg-fb-accent-soft p-4 text-sm text-fb-accent">{message}</div>}
      <section className="rounded-xl border border-fb-border bg-fb-main p-5">
        <h2 className="text-lg font-bold">Kilometerstand nachtragen</h2>
        <p className="mt-1 text-sm text-fb-muted">Kilometerstände können für beliebige Tage nachgetragen werden. Mehrere Zwischenablesungen pro Monat sind möglich; die Reihenfolge zu vorherigen und folgenden Messwerten wird geprüft.</p>
        <form onSubmit={saveReading} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_180px_auto] sm:items-end">
          <label className="text-sm"><span className="mb-1 block text-fb-muted">Fahrzeug</span><select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="w-full rounded-lg border border-fb-border bg-fb-main px-3 py-2">{vehicles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1 block text-fb-muted">Ablesedatum</span><input type="date" value={entryDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setEntryDate(e.target.value)} className="w-full rounded-lg border border-fb-border bg-fb-main px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-fb-muted">Kilometerstand</span><div className="flex items-center gap-2"><input inputMode="decimal" value={entryKm} onChange={(e) => setEntryKm(e.target.value)} placeholder="z. B. 82450" className="min-w-0 w-full rounded-lg border border-fb-border bg-fb-main px-3 py-2" /><span className="text-fb-muted">km</span></div></label>
          <button type="submit" disabled={savingReading || !vehicleId || !entryDate || !entryKm} className="rounded-lg bg-fb-accent px-4 py-2 font-semibold text-fb-accent-text disabled:opacity-50">{savingReading ? "Speichert …" : "Speichern"}</button>
        </form>
        {readings.filter((r) => r.vehicleId === vehicleId).length > 0 && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-fb-border pt-4"><div><p className="text-sm font-semibold">Ableseprotokoll</p><p className="mt-1 text-xs text-fb-muted">{readings.filter((r) => r.vehicleId === vehicleId).length} gespeicherte Ablesungen</p></div><button type="button" onClick={() => setReadingLogOpen(true)} className="rounded-lg border border-fb-border px-4 py-2 text-sm font-semibold hover:border-fb-accent">Ableseprotokoll anzeigen</button></div>}
      </section>
      {leasing && <section className={`rounded-xl border p-5 ${leasing.deviationKm > 0 ? "border-fb-danger bg-fb-main" : "border-fb-border bg-fb-main"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-bold">{leasing.vehicle.acquisitionType === "leasing" ? "Leasing-Kilometer" : "Vertragskilometer"}</h2><p className="mt-1 text-sm text-fb-muted">{new Intl.DateTimeFormat("de-DE").format(new Date(`${leasing.vehicle.leaseStartDate.slice(0,10)}T00:00:00`))} – {new Intl.DateTimeFormat("de-DE").format(new Date(`${leasing.vehicle.leaseEndDate.slice(0,10)}T00:00:00`))} · {km(leasing.vehicle.leaseIncludedKm)} Kilometerlimit</p></div>{leasing.deviationKm > 0 && <span className="rounded-full border border-fb-danger px-3 py-1 text-sm font-semibold text-fb-danger">{leasing.vehicle.acquisitionType === "leasing" ? "Mehrkilometer erwartet" : "Kilometerlimit voraussichtlich überschritten"}</span>}</div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div><div className="text-xs text-fb-muted">Bisher gefahren</div><div className="mt-1 text-xl font-bold">{km(leasing.drivenKm)}</div></div><div><div className="text-xs text-fb-muted">Zeitanteilig vorgesehen</div><div className="mt-1 text-xl font-bold">{km(leasing.allowedKm)}</div></div><div><div className="text-xs text-fb-muted">Prognose Vertragsende</div><div className="mt-1 text-xl font-bold">{km(leasing.projectedKm)}</div></div><div><div className="text-xs text-fb-muted">Prognose Abweichung</div><div className={`mt-1 text-xl font-bold ${leasing.deviationKm > 0 ? "text-fb-danger" : "text-fb-accent"}`}>{leasing.deviationKm > 0 ? "+" : ""}{km(leasing.deviationKm)}</div></div></div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-fb-surface"><div className={`h-full rounded-full ${leasing.deviationKm > 0 ? "bg-fb-danger" : "bg-fb-accent"}`} style={{ width: `${Math.min(100, Math.max(0, leasing.elapsedPercent))}%` }} /></div>
      </section>}
      <section className="rounded-xl border border-fb-border bg-fb-main p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-lg font-bold">Kilometerentwicklung</h2><p className="mt-1 text-sm text-fb-muted">Vergleich der Kilometer laut Ablesungen mit den im Fahrtenbuch erfassten Strecken.</p></div>
          <label className="text-xs text-fb-muted"><span className="mb-1 block">Jahr</span><select value={chartYear} onChange={(e) => setChartYear(e.target.value)} className="rounded-lg border border-fb-border bg-fb-main px-3 py-2 text-sm">{chartYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
        </div>
        {chartData.length > 0 ? <StatisticsChart data={chartData} /> : <div className="mt-5 rounded-lg bg-fb-surface p-6 text-center text-sm text-fb-muted">Für diesen Zeitraum liegen noch nicht genügend Ablesungen für ein Diagramm vor.</div>}
      </section>
      {intervals.length > 0 && (
        <section className="rounded-xl border border-fb-border bg-fb-main p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-bold">Genauigkeit nach Ableseintervall</h2><p className="mt-1 text-sm text-fb-muted">Abweichungen zwischen Kilometerständen und erfassten Fahrten.</p></div>
            <button type="button" onClick={() => setIntervalModalOpen(true)} className="rounded-lg border border-fb-border px-4 py-2 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent">Details anzeigen</button>
          </div>
        </section>
      )}
      {intervalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIntervalModalOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="interval-modal-title" className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-fb-border bg-fb-main shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-fb-border p-5">
              <h2 id="interval-modal-title" className="text-lg font-bold">Genauigkeit nach Ableseintervall</h2>
              <button type="button" onClick={() => setIntervalModalOpen(false)} aria-label="Schließen" className="rounded-lg border border-fb-border px-3 py-2 text-sm hover:border-fb-accent">Schließen</button>
            </div>
            <div className="overflow-y-auto p-5">
          <p className="mt-1 text-sm text-fb-muted">Je kürzer die Intervalle zwischen zwei Ablesungen sind, desto genauer lässt sich erkennen, in welchem Zeitraum Kilometer nicht durch aufgezeichnete Fahrten erklärt werden.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-fb-border text-fb-muted">
                <tr><th className="py-2 pr-4">Zeitraum</th><th className="py-2 pr-4">Kilometerstand</th><th className="py-2 pr-4">Tatsächlich</th><th className="py-2 pr-4">Erfasst</th><th className="py-2 pr-4">Differenz</th><th className="py-2">Fahrten</th></tr>
              </thead>
              <tbody>
                {intervals.map((item) => {
                  const formatDate = (value) => new Intl.DateTimeFormat("de-DE").format(new Date(`${value}T00:00:00`));
                  const significant = Math.abs(item.differenceKm) > Math.max(1, item.actualKm * 0.05);
                  return <tr key={`${item.startReadingId}-${item.endReadingId}`} className="border-b border-fb-border/60 last:border-0">
                    <td className="py-3 pr-4 font-semibold">{formatDate(item.startDate)} – {formatDate(item.endDate)}</td>
                    <td className="py-3 pr-4">{km(item.startOdometerKm)} → {km(item.endOdometerKm)}</td>
                    <td className="py-3 pr-4">{km(item.actualKm)}</td>
                    <td className="py-3 pr-4">{km(item.trackedKm)}</td>
                    <td className={`py-3 pr-4 font-semibold ${significant ? "text-fb-danger" : ""}`}>{item.differenceKm > 0 ? "+" : ""}{km(item.differenceKm)}</td>
                    <td className="py-3">{item.tripCount}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
            </div>
          </section>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <select value={vehicleId} onChange={(e) => {
          const nextVehicleId = e.target.value;
          setVehicleId(nextVehicleId);
          setMonth(rows.find((row) => row.vehicleId === nextVehicleId)?.month || "");
        }} className="rounded-lg border border-fb-border bg-fb-main px-3 py-2">
          {vehicles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select
          value={selectedYear}
          disabled={availableYears.length === 0}
          onChange={(e) => {
            const year = e.target.value;
            const firstMonth = availableMonths.find((value) => value.startsWith(`${year}-`));
            setMonth(firstMonth || "");
          }}
          className="rounded-lg border border-fb-border bg-fb-main px-3 py-2 disabled:opacity-50"
        >
          {availableYears.length === 0 && <option value="">Kein Jahr</option>}
          {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <select
          value={month}
          disabled={monthsForYear.length === 0}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-fb-border bg-fb-main px-3 py-2 disabled:opacity-50"
        >
          {monthsForYear.length === 0 && <option value="">Kein Monat</option>}
          {monthsForYear.map((value) => <option key={value} value={value}>{monthLabel(value).replace(/\s+\d{4}$/, "")}</option>)}
        </select>
      </div>
      {selected && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-fb-border bg-fb-main p-5">
              <div className="text-sm text-fb-muted">Gefahren laut Kilometerstand</div>
              <div className="mt-2 text-3xl font-bold">{km(selected.actualKm)}</div>
              {selected.actualKm == null && <div className="mt-2 text-xs text-fb-muted">Für diesen Monat fehlen geeignete Ablesungen an den Monatsgrenzen.</div>}
            </div>
            <div className="rounded-xl border border-fb-border bg-fb-main p-5">
              <div className="text-sm text-fb-muted">Aufgezeichnet</div>
              <div className="mt-2 text-3xl font-bold">{km(selected.trackedKm)}</div>
            </div>
            <div className="rounded-xl border border-fb-border bg-fb-main p-5">
              <div className="text-sm text-fb-muted">Unbekannt / nicht erfasst</div>
              <div className="mt-2 text-3xl font-bold">{km(selected.unknownKm)}</div>
            </div>
          </div>
          <section className="rounded-xl border border-fb-border bg-fb-main p-5">
            <h2 className="text-lg font-bold">{monthLabel(selected.month)}</h2>
            <div className="mt-5 space-y-4">
              {parts.map(([key, value]) => {
                const percent = total > 0 && value != null ? Math.min(100, Math.max(0, Number(value) / total * 100)) : 0;
                return (
                  <div key={key}>
                    <div className="flex justify-between gap-4 text-sm">
                      <span>{labels[key]}</span>
                      <span className="font-semibold">{km(value)} · {percent.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-fb-surface">
                      <div className="h-full rounded-full bg-fb-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 border-t border-fb-border pt-4 text-sm text-fb-muted">
              Kilometerstand: {km(selected.startOdometerKm)} → {km(selected.endOdometerKm)}
            </div>
          </section>
        </>
      )}
      <OdometerReadingLogModal
        open={readingLogOpen}
        onClose={() => setReadingLogOpen(false)}
        readings={readings.filter((reading) => reading.vehicleId === vehicleId)}
        vehicleName={vehicles.find(([id]) => id === vehicleId)?.[1]}
        onEdit={(reading) => {
          setEntryDate(reading.readingDate || `${reading.month}-01`);
          setEntryKm(String(reading.odometerKm));
        }}
      />
    </div>
  );
}
