import { useEffect, useMemo, useState } from "react";

import { getMonthlyOdometerStatistics } from "../api/app.js";
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
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" })
    .format(new Date(year, month - 1, 1));
}

export default function Statistics() {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState([]);
  const [vehicleId, setVehicleId] = useState("");
  const [month, setMonth] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getMonthlyOdometerStatistics(accessToken, 18)
      .then((result) => {
        setRows(result);
        const latestComplete = result.find((row) => row.actualKm != null) || result[0];
        if (latestComplete) {
          setVehicleId(latestComplete.vehicleId);
          setMonth(latestComplete.month);
        }
      })
      .catch((loadError) => setError(loadError.message));
  }, [accessToken]);

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
              {selected.actualKm == null && <div className="mt-2 text-xs text-fb-muted">Für diesen Monat fehlen zwei aufeinanderfolgende Monatsmesswerte.</div>}
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
