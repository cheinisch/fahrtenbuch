import { useEffect, useMemo, useState } from "react";

import { getMonthlyOdometerStatistics, getOdometerIntervalStatistics, getOdometerReadings, saveMonthlyOdometerReading } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

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

export default function Statistics() {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState([]);
  const [vehicleId, setVehicleId] = useState("");
  const [month, setMonth] = useState("");
  const [error, setError] = useState("");
  const [readings, setReadings] = useState([]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryKm, setEntryKm] = useState("");
  const [savingReading, setSavingReading] = useState(false);
  const [message, setMessage] = useState("");
  const [intervals, setIntervals] = useState([]);

  async function loadData() {
    try {
      const [result, readingRows] = await Promise.all([
        getMonthlyOdometerStatistics(accessToken, 18),
        getOdometerReadings(accessToken),
      ]);
      setRows(result);
      setReadings(readingRows);
      const latestComplete = result.find((row) => row.actualKm != null) || result[0];
      if (latestComplete && !vehicleId) {
        setVehicleId(latestComplete.vehicleId);
        setMonth(latestComplete.month);
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
    getOdometerIntervalStatistics(accessToken, vehicleId, 18)
      .then(setIntervals)
      .catch((loadError) => setError(loadError.message));
  }, [accessToken, vehicleId, readings]);

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

  const vehicles = useMemo(() => Array.from(
    new Map(rows.map((row) => [row.vehicleId, row.vehicleName])).entries(),
  ), [rows]);

  const months = useMemo(() => Array.from(new Set(
    rows.filter((row) => !vehicleId || row.vehicleId === vehicleId).map((row) => row.month),
  )), [rows, vehicleId]);

  const selected = rows.find((row) => row.vehicleId === vehicleId && row.month === month) || null;
  const total = selected?.actualKm ?? selected?.trackedKm ?? 0;
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
        {readings.filter((r) => r.vehicleId === vehicleId).length > 0 && <div className="mt-5 border-t border-fb-border pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-fb-muted">Ablesungsprotokoll</p><div className="mt-2 flex flex-wrap gap-2">{readings.filter((r) => r.vehicleId === vehicleId).slice(0, 12).map((r) => <button key={r.id} type="button" onClick={() => { setEntryDate(r.readingDate || `${r.month}-01`); setEntryKm(String(r.odometerKm)); }} className="rounded-lg border border-fb-border px-3 py-2 text-left text-sm hover:border-fb-accent"><span className="font-semibold">{r.readingDate ? new Intl.DateTimeFormat("de-DE").format(new Date(`${r.readingDate}T00:00:00`)) : monthLabel(r.month)}</span><span className="ml-2 text-fb-muted">{km(r.odometerKm)}</span></button>)}</div></div>}
      </section>
      {intervals.length > 0 && (
        <section className="rounded-xl border border-fb-border bg-fb-main p-5">
          <h2 className="text-lg font-bold">Genauigkeit nach Ableseintervall</h2>
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
        </section>
      )}
      <div className="flex flex-wrap gap-3">
        <select value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setMonth(""); }} className="rounded-lg border border-fb-border bg-fb-main px-3 py-2">
          {vehicles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-fb-border bg-fb-main px-3 py-2">
          <option value="">Monat wählen</option>
          {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
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
                const percent = total > 0 && value != null ? Math.max(0, value / total * 100) : 0;
                return (
                  <div key={key}>
                    <div className="flex justify-between gap-4 text-sm">
                      <span>{labels[key]}</span>
                      <span className="font-semibold">{km(value)} · {percent.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-fb-surface">
                      <div className="h-full rounded-full bg-fb-accent" style={{ width: `${Math.min(100, percent)}%` }} />
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
    </div>
  );
}
