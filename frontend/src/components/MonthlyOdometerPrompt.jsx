import { useEffect, useMemo, useState } from "react";

import {
  getPendingOdometerReadings,
  saveMonthlyOdometerReading,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

function monthLabel(value) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" })
    .format(new Date(year, month - 1, 1));
}

export default function MonthlyOdometerPrompt() {
  const { accessToken } = useAuth();
  const [pending, setPending] = useState([]);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = pending[0] || null;

  useEffect(() => {
    getPendingOdometerReadings(accessToken)
      .then(setPending)
      .catch(() => {});
  }, [accessToken]);

  useEffect(() => {
    setValue(current?.lastOdometerKm == null ? "" : String(current.lastOdometerKm));
  }, [current?.vehicleId, current?.month]);

  const title = useMemo(
    () => current ? `Kilometerstand für ${monthLabel(current.month)}` : "",
    [current],
  );

  if (!current || dismissed) return null;

  async function save() {
    const odometerKm = Number(String(value).replace(",", "."));
    if (!Number.isFinite(odometerKm) || odometerKm < 0) {
      setError("Bitte einen gültigen Kilometerstand eingeben.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveMonthlyOdometerReading(accessToken, current.vehicleId, current.month, odometerKm);
      setPending((items) => items.slice(1));
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-fb-border bg-fb-main p-6 shadow-2xl">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="mt-2 text-sm text-fb-muted">
          Für <strong className="text-fb-text">{current.vehicleName}</strong>
          {current.licensePlate ? ` (${current.licensePlate})` : ""} fehlt der monatliche Kilometerstand.
          Er dient dazu, nicht aufgezeichnete Kilometer in der Statistik zu erkennen.
        </p>
        {current.lastOdometerKm != null && (
          <p className="mt-3 text-sm text-fb-muted">
            Letzter Messwert: {current.lastOdometerKm.toLocaleString("de-DE")} km
            {current.lastReadingMonth ? ` (${monthLabel(current.lastReadingMonth)})` : ""}
          </p>
        )}
        <label className="mt-5 block text-sm font-medium">
          Kilometerstand
          <div className="mt-2 flex items-center gap-2">
            <input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && save()}
              className="min-w-0 flex-1 rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5"
            />
            <span className="text-sm text-fb-muted">km</span>
          </div>
        </label>
        {error && <p className="mt-3 text-sm text-fb-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => setDismissed(true)} className="rounded-lg border border-fb-border px-4 py-2 text-sm font-semibold">
            Später erinnern
          </button>
          <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-fb-accent px-4 py-2 text-sm font-semibold text-fb-accent-text disabled:opacity-60">
            {busy ? "Speichere …" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
