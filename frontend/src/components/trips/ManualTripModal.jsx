import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useFeatures } from "../../lib/features.jsx";
import { createTrip, estimateRoute, getSavedPlaces, getVehicles, searchAddresses } from "../../api/app.js";

const TRIP_TYPES = ["unclassified", "business", "private", "commute"];

const fieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

function today() {
  // Lokales Kalenderdatum, nicht UTC (sonst kurz nach Mitternacht der Vortag)
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function initialState(vehicleId) {
  const date = today();
  return {
    vehicleId: vehicleId || "",
    type: "unclassified",
    startDate: date,
    startTime: "",
    endDate: date,
    endTime: "",
    start: { address: "", coordinate: null },
    end: { address: "", coordinate: null },
    distanceKm: "",
    purpose: "",
    notes: "",
  };
}

/**
 * Adressfeld mit Vorschlägen: gespeicherte Orte sofort, Photon-Treffer nach kurzer Pause.
 * Freitext ist erlaubt – dann fehlen nur die Koordinaten (keine Streckenberechnung).
 */
function AddressField({ id, label, value, onChange, savedPlaces, accessToken, geocodingEnabled }) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const query = value.address.trim();
  const saved = savedPlaces
    .filter((place) => !query || `${place.name} ${place.address || ""}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5)
    .map((place) => ({
      key: `saved-${place.id}`,
      title: place.name,
      subtitle: place.address,
      address: place.address ? `${place.name}, ${place.address}` : place.name,
      coordinate: { lat: place.latitude, lon: place.longitude },
    }));

  useEffect(() => {
    if (!open || !geocodingEnabled || query.length < 3 || value.coordinate) {
      setResults([]);
      return undefined;
    }
    const current = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await searchAddresses(accessToken, query, language);
        if (current === requestRef.current) {
          setResults((response.results || []).map((result, index) => ({
            key: result.id || `photon-${index}`,
            title: result.name || result.address,
            subtitle: result.name ? result.address : null,
            address: result.address,
            coordinate: { lat: result.latitude, lon: result.longitude },
          })));
        }
      } catch {
        if (current === requestRef.current) setResults([]);
      } finally {
        if (current === requestRef.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [open, geocodingEnabled, query, value.coordinate, accessToken, language]);

  const options = [...saved, ...results];

  return (
    <div className="relative">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        className={fieldClass}
        value={value.address}
        placeholder={t("manualTrip.addressPlaceholder")}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => onChange({ address: event.target.value, coordinate: null })}
      />
      <p className="mt-1 text-xs text-fb-muted">
        {value.coordinate ? t("manualTrip.addressLocated") : value.address ? t("manualTrip.addressNotLocated") : " "}
      </p>
      {open && (options.length > 0 || loading) && (
        <ul role="listbox" className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-fb-border bg-fb-main shadow-xl">
          {options.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onChange({ address: option.address, coordinate: option.coordinate }); setOpen(false); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-fb-surface"
              >
                <span className="font-medium">{option.title}</span>
                {option.subtitle && <span className="block text-xs text-fb-muted">{option.subtitle}</span>}
              </button>
            </li>
          ))}
          {loading && <li className="px-3 py-2 text-xs text-fb-muted">{t("manualTrip.searching")}</li>}
        </ul>
      )}
    </div>
  );
}

export default function ManualTripModal({ open, accessToken, onClose, onCreated }) {
  const { t, locale } = useI18n();
  const { geocodingEnabled, routingEnabled } = useFeatures();
  const [form, setForm] = useState(() => initialState(""));
  const [vehicles, setVehicles] = useState([]);
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [routing, setRouting] = useState({ busy: false, info: "" });

  useEffect(() => {
    if (!open) return undefined;
    setForm(initialState(""));
    setError("");
    setRouting({ busy: false, info: "" });
    let active = true;
    getVehicles(accessToken)
      .then((list) => {
        if (!active) return;
        const rows = Array.isArray(list) ? list : [];
        setVehicles(rows);
        // Standardfahrzeug vorauswählen, sonst das erste
        const preferred = rows.find((vehicle) => vehicle.isDefault) || rows[0];
        setForm((current) => (current.vehicleId ? current : { ...current, vehicleId: preferred?.id || "" }));
      })
      .catch((loadError) => { if (active) setError(loadError.message); });
    getSavedPlaces(accessToken)
      .then((places) => { if (active) setSavedPlaces(Array.isArray(places) ? places : []); })
      .catch(() => {});
    return () => { active = false; };
  }, [open, accessToken]);

  function update(name, value) {
    setForm((current) => {
      const next = { ...current, [name]: value };
      // Enddatum folgt dem Startdatum, solange es nicht davor liegt
      if (name === "startDate" && (current.endDate === current.startDate || current.endDate < value)) next.endDate = value;
      return next;
    });
  }

  const canRoute = routingEnabled && form.start.coordinate && form.end.coordinate;

  async function calculateDistance() {
    if (!canRoute) return;
    setRouting({ busy: true, info: "" });
    try {
      const route = await estimateRoute(accessToken, form.start.coordinate, form.end.coordinate);
      const km = Math.round(route.distanceMeters / 100) / 10;
      update("distanceKm", String(km));
      const minutes = route.durationSeconds ? Math.round(route.durationSeconds / 60) : null;
      setRouting({
        busy: false,
        info: minutes
          ? t("manualTrip.routeInfoDuration", { km: km.toLocaleString(locale), minutes })
          : t("manualTrip.routeInfo", { km: km.toLocaleString(locale) }),
      });
    } catch (routeError) {
      setRouting({ busy: false, info: routeError.message });
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    // Eingaben gelten in der Zeitzone des Browsers; sie wird mit der Fahrt gespeichert
    const startedAt = new Date(`${form.startDate}T${form.startTime}`);
    const endedAt = new Date(`${form.endDate}T${form.endTime}`);
    if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime())) {
      setError(t("manualTrip.errors.time"));
      return;
    }
    if (endedAt <= startedAt) {
      setError(t("manualTrip.errors.endBeforeStart"));
      return;
    }
    const distance = form.distanceKm === "" ? null : Number(String(form.distanceKm).replace(",", "."));
    if (distance !== null && (!Number.isFinite(distance) || distance < 0)) {
      setError(t("manualTrip.errors.distance"));
      return;
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setSaving(true);
    try {
      const trip = await createTrip(accessToken, {
        vehicleId: form.vehicleId,
        type: form.type,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        startTimeZone: timeZone,
        endTimeZone: timeZone,
        startAddress: form.start.address.trim() || null,
        endAddress: form.end.address.trim() || null,
        startLat: form.start.coordinate?.lat ?? null,
        startLon: form.start.coordinate?.lon ?? null,
        endLat: form.end.coordinate?.lat ?? null,
        endLon: form.end.coordinate?.lon ?? null,
        distanceKm: distance,
        purpose: form.purpose.trim() || null,
        notes: form.notes.trim() || null,
      });
      onCreated(trip);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={saving ? () => {} : onClose} className="relative z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel className="w-full max-w-2xl rounded-2xl border border-fb-border bg-fb-main shadow-2xl">
            <header className="flex items-start justify-between border-b border-fb-border px-5 py-4 sm:px-6">
              <div>
                <DialogTitle className="text-xl font-bold">{t("manualTrip.title")}</DialogTitle>
                <p className="mt-1 text-sm text-fb-muted">{t("manualTrip.description")}</p>
              </div>
              <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-fb-muted hover:bg-fb-surface hover:text-fb-text disabled:opacity-50">
                <span className="sr-only">{t("common.close")}</span>
                <XMarkIcon className="size-5" />
              </button>
            </header>

            <form onSubmit={submit}>
              <div className="space-y-5 p-5 sm:p-6">
                {error && <div role="alert" className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{error}</div>}

                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-medium">{t("manualTrip.vehicle")}
                    <select value={form.vehicleId} onChange={(event) => update("vehicleId", event.target.value)} required className={fieldClass}>
                      {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.licensePlate ? `${vehicle.name} (${vehicle.licensePlate})` : vehicle.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium">{t("manualTrip.type")}
                    <select value={form.type} onChange={(event) => update("type", event.target.value)} className={fieldClass}>
                      {TRIP_TYPES.map((type) => <option key={type} value={type}>{t(`dashboard.tripTypes.${type}`)}</option>)}
                    </select>
                  </label>
                </div>

                <fieldset className="grid gap-5 sm:grid-cols-2">
                  <legend className="sr-only">{t("manualTrip.startLegend")}</legend>
                  <label className="text-sm font-medium">{t("manualTrip.startDate")}
                    <input type="date" required value={form.startDate} onChange={(event) => update("startDate", event.target.value)} className={fieldClass} />
                  </label>
                  <label className="text-sm font-medium">{t("manualTrip.startTime")}
                    <input type="time" required value={form.startTime} onChange={(event) => update("startTime", event.target.value)} className={fieldClass} />
                  </label>
                  <label className="text-sm font-medium">{t("manualTrip.endDate")}
                    <input type="date" required min={form.startDate} value={form.endDate} onChange={(event) => update("endDate", event.target.value)} className={fieldClass} />
                  </label>
                  <label className="text-sm font-medium">{t("manualTrip.endTime")}
                    <input type="time" required value={form.endTime} onChange={(event) => update("endTime", event.target.value)} className={fieldClass} />
                  </label>
                </fieldset>

                <div className="grid gap-5 sm:grid-cols-2">
                  <AddressField
                    id="manual-trip-start"
                    label={t("manualTrip.startAddress")}
                    value={form.start}
                    onChange={(value) => update("start", value)}
                    savedPlaces={savedPlaces}
                    accessToken={accessToken}
                    geocodingEnabled={geocodingEnabled}
                  />
                  <AddressField
                    id="manual-trip-end"
                    label={t("manualTrip.endAddress")}
                    value={form.end}
                    onChange={(value) => update("end", value)}
                    savedPlaces={savedPlaces}
                    accessToken={accessToken}
                    geocodingEnabled={geocodingEnabled}
                  />
                </div>

                <div>
                  <label htmlFor="manual-trip-distance" className="text-sm font-medium">{t("manualTrip.distance")}</label>
                  <div className="flex flex-wrap items-end gap-3">
                    <input
                      id="manual-trip-distance"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="10000"
                      step="0.1"
                      value={form.distanceKm}
                      onChange={(event) => update("distanceKm", event.target.value)}
                      className={`${fieldClass} max-w-40`}
                    />
                    {routingEnabled && (
                      <button
                        type="button"
                        onClick={calculateDistance}
                        disabled={!canRoute || routing.busy}
                        title={canRoute ? undefined : t("manualTrip.routeNeedsAddresses")}
                        className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold hover:border-fb-accent disabled:opacity-60"
                      >
                        {routing.busy ? t("manualTrip.routeCalculating") : t("manualTrip.routeCalculate")}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-fb-muted">{routing.info || t("manualTrip.distanceHint")}</p>
                </div>

                <label className="block text-sm font-medium">{t("manualTrip.purpose")}
                  <input type="text" maxLength={1000} value={form.purpose} onChange={(event) => update("purpose", event.target.value)} className={fieldClass} />
                </label>
                <label className="block text-sm font-medium">{t("manualTrip.notes")}
                  <textarea rows={3} maxLength={20000} value={form.notes} onChange={(event) => update("notes", event.target.value)} className={fieldClass} />
                </label>
              </div>

              <footer className="flex justify-end gap-3 border-t border-fb-border px-5 py-4 sm:px-6">
                <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold hover:border-fb-accent disabled:opacity-60">
                  {t("common.cancel")}
                </button>
                <button type="submit" disabled={saving || !form.vehicleId} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-60">
                  {saving ? t("common.saving") : t("manualTrip.save")}
                </button>
              </footer>
            </form>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
