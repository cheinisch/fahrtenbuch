import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, MapPinIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  classifyTrip,
  createSavedPlace,
  getMonthlyReport,
  getPersonalSettings,
  sendMonthlyReport,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { DEFAULT_ROUTE_COLORS } from "../lib/routeColors.js";

// Monatsbericht in der Web-App: gleicher Aufbau wie die Mail am Monatsersten,
// dazu direkt zuordnen und Orte speichern.

const MI = 1.609344;
const COLORS = {
  business: DEFAULT_ROUTE_COLORS.business,
  private: DEFAULT_ROUTE_COLORS.private,
  commute: DEFAULT_ROUTE_COLORS.commute,
  open: DEFAULT_ROUTE_COLORS.unclassified,
  other: "#0c4a6e",
};
const HATCH = "repeating-linear-gradient(135deg, #a8a8a4 0 3px, transparent 3px 6px)";

const fieldClass =
  "mt-1.5 block h-11 w-full rounded-lg border border-fb-border bg-fb-main px-3 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent/30";

function shiftMonth(month, delta) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function segmentsOf(vehicle) {
  return [
    ["business", vehicle.businessKm],
    ["private", vehicle.privateKm],
    ["commute", vehicle.commuteKm],
    ["open", vehicle.unclassifiedKm],
    ["other", vehicle.otherDriversKm],
    ["unexplained", vehicle.unexplainedKm || 0],
  ].filter(([, value]) => value > 0.05);
}

function Swatch({ kind }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 shrink-0 rounded-[2px]"
      style={kind === "unexplained" ? { backgroundImage: HATCH, boxShadow: "inset 0 0 0 1px #a8a8a4" } : { background: COLORS[kind] }}
    />
  );
}

function SavePlaceForm({ place, onSaved, onCancel }) {
  const { accessToken } = useAuth();
  const { t } = useI18n();
  const [name, setName] = useState(() => String(place.address || "").split(",")[0].trim());
  const [type, setType] = useState(place.mainType || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createSavedPlace(accessToken, {
        name: name.trim(),
        address: place.address || null,
        latitude: place.latitude,
        longitude: place.longitude,
        suggestedType: type || null,
        purpose: place.purpose || null,
      });
      onSaved();
    } catch (saveError) {
      setError(saveError.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-lg bg-fb-surface p-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
      <label className="block text-sm font-medium">
        {t("monthlyReport.places.name")}
        <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoFocus />
      </label>
      <label className="block text-sm font-medium">
        {t("monthlyReport.places.suggestedType")}
        <select className={fieldClass} value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">{t("monthlyReport.places.noSuggestion")}</option>
          <option value="business">{t("monthlyReport.categories.business")}</option>
          <option value="private">{t("monthlyReport.categories.private")}</option>
          <option value="commute">{t("monthlyReport.categories.commute")}</option>
        </select>
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-fb-border bg-fb-main px-3 text-sm font-semibold">{t("common.cancel")}</button>
        <button type="submit" disabled={busy || !name.trim()} className="h-11 rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text disabled:opacity-60">
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-fb-danger sm:col-span-3">{error}</p>}
    </form>
  );
}

export default function MonthlyReport() {
  const { accessToken } = useAuth();
  const { t, locale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMonth = searchParams.get("month");
  const requestedPlace = searchParams.get("place");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyTrip, setBusyTrip] = useState("");
  const [openPlace, setOpenPlace] = useState(requestedPlace);
  const [mailAvailable, setMailAvailable] = useState(false);
  const [sendState, setSendState] = useState({ busy: false, message: "", error: "" });

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await getMonthlyReport(accessToken, requestedMonth);
      setReport(result);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, requestedMonth]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    getPersonalSettings(accessToken)
      .then((result) => setMailAvailable(result?.settings?.monthlyReportAvailable === true))
      .catch(() => {});
  }, [accessToken]);

  // Link aus der Mail (#open-trips, #new-places) erst nach dem Laden anspringen
  useEffect(() => {
    if (!report || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [report]);

  const format = useMemo(() => {
    const unit = report?.distanceUnit === "mi" ? "mi" : "km";
    const factor = unit === "mi" ? 1 / MI : 1;
    const number = (value, digits = 0) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
    const date = (iso, options) => new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
    return {
      unit,
      distance: (km, digits = 0) => `${number(km * factor, digits)} ${unit}`,
      distanceNumber: (km) => number(km * factor, 0),
      number,
      monthYear: (month) => date(`${month}-01`, { month: "long", year: "numeric" }),
      monthName: (month) => date(`${month}-01`, { month: "long" }),
      dayMonth: (iso) => date(iso, { day: "2-digit", month: "2-digit" }),
      dayMonthYear: (iso) => date(iso, { day: "2-digit", month: "2-digit", year: "numeric" }),
      weekdayDay: (iso) => date(iso, { weekday: "short", day: "2-digit", month: "2-digit" }),
    };
  }, [report?.distanceUnit, locale]);

  function goToMonth(month) {
    setOpenPlace(null);
    setSearchParams({ month }, { replace: false });
  }

  async function assign(trip, category) {
    setBusyTrip(trip.id);
    try {
      await classifyTrip(accessToken, trip.id, category);
      await load();
    } catch (assignError) {
      setError(assignError.message);
    } finally {
      setBusyTrip("");
    }
  }

  async function sendNow() {
    setSendState({ busy: true, message: "", error: "" });
    try {
      const result = await sendMonthlyReport(accessToken, report.month);
      setSendState({ busy: false, message: t("monthlyReport.sent", { email: result.to || "" }), error: "" });
    } catch (sendError) {
      setSendState({ busy: false, message: "", error: sendError.message });
    }
  }

  if (loading && !report) {
    return <div className="rounded-xl border border-fb-border bg-fb-main p-8 text-fb-muted">{t("common.loading")}</div>;
  }
  if (!report) {
    return <div role="alert" className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error || t("common.requestFailed")}</div>;
  }

  const { totals } = report;
  const monthName = format.monthName(report.month);
  const categoryLabels = {
    business: t("monthlyReport.categories.business"),
    private: t("monthlyReport.categories.private"),
    commute: t("monthlyReport.categories.commute"),
    open: t("monthlyReport.categories.open"),
    other: t("monthlyReport.categories.other"),
    unexplained: t("monthlyReport.categories.unexplained"),
  };
  const legendLabels = {
    ...categoryLabels,
    open: t("monthlyReport.legend.open"),
    other: t("monthlyReport.legend.other"),
    unexplained: t("monthlyReport.legend.unexplained"),
  };
  const usedKinds = new Set(report.vehicles.flatMap((vehicle) => segmentsOf(vehicle).map(([kind]) => kind)));
  const placeDetails = (place) => {
    const parts = [
      t("monthlyReport.places.firstVisit", { date: format.dayMonth(place.firstVisit) }),
      place.tripCount === 1 ? t("monthlyReport.places.oneTrip") : t("monthlyReport.places.trips", { count: place.tripCount }),
      format.distance(place.distanceKm, 1),
    ];
    if (place.openTripCount > 0 && place.openTripCount === place.tripCount) {
      parts.push(place.tripCount === 1 ? t("monthlyReport.places.openOne") : place.tripCount === 2 ? t("monthlyReport.places.openBoth") : t("monthlyReport.places.openAll"));
    } else if (place.openTripCount > 0) {
      parts.push(t("monthlyReport.places.openSome", { count: place.openTripCount }));
    } else if (place.mainType) {
      parts.push([t(`monthlyReport.types.${place.mainType}`), place.purpose].filter(Boolean).join(", "));
    }
    return parts.join(" · ");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => goToMonth(shiftMonth(report.month, -1))} aria-label={t("monthlyReport.previous")} className="flex size-11 items-center justify-center rounded-lg border border-fb-border bg-fb-main hover:border-fb-accent">
            <ChevronLeftIcon aria-hidden="true" className="size-5" />
          </button>
          <h1 className="text-2xl font-bold tracking-tight">{t("monthlyReport.title", { month: format.monthYear(report.month) })}</h1>
          <button type="button" onClick={() => goToMonth(shiftMonth(report.month, 1))} aria-label={t("monthlyReport.next")} className="flex size-11 items-center justify-center rounded-lg border border-fb-border bg-fb-main hover:border-fb-accent">
            <ChevronRightIcon aria-hidden="true" className="size-5" />
          </button>
        </div>
        <Link to="/statistics" className="text-sm font-semibold text-fb-accent-strong hover:underline">{t("monthlyReport.toStatistics")}</Link>
      </div>

      {error && <div role="alert" className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-fb-border bg-fb-main">
        <div className="space-y-4 bg-[#0c4a6e] px-5 py-6 text-sky-50 sm:px-7">
          <div>
            <p className="text-2xl font-bold leading-tight">{t("monthlyReport.heading", { month: monthName })}</p>
            <p className="mt-1 text-sm text-sky-200">{t("monthlyReport.period", { from: format.dayMonth(report.from), to: format.dayMonthYear(report.to) })}</p>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              [t("monthlyReport.driven"), format.distance(totals.drivenKm)],
              [t("monthlyReport.business"), format.distance(totals.businessKm)],
              [t("monthlyReport.trips"), format.number(totals.tripCount)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-[#0e5c86] px-3.5 py-3">
                <div className="text-xs text-sky-200">{label}</div>
                <div className="text-lg font-bold sm:text-xl">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-7 px-5 py-6 sm:px-7">
          {totals.openTripCount > 0 ? (
            <section id="open-trips" className="scroll-mt-24 space-y-3 rounded-xl bg-fb-warn-soft p-4 text-fb-warn">
              <div>
                <h2 className="text-base font-bold">
                  {totals.openTripCount === 1 ? t("monthlyReport.open.titleOne") : t("monthlyReport.open.title", { count: totals.openTripCount })}
                </h2>
                <p className="mt-1 text-sm leading-relaxed">{t("monthlyReport.open.text", { km: format.distance(totals.openKm) })}</p>
              </div>
              <ul className="divide-y divide-fb-border overflow-hidden rounded-lg bg-fb-main text-fb-text">
                {report.openTrips.map((trip) => (
                  <li key={trip.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm">
                    <span className="w-20 shrink-0 tabular-nums">{format.weekdayDay(trip.localStart)}</span>
                    <span className="min-w-0 flex-1">
                      <Link to={`/?trip=${encodeURIComponent(trip.id)}`} className="font-medium hover:underline">
                        {trip.startAddress || t("monthlyReport.unknown")} → {trip.endAddress || t("monthlyReport.unknown")}
                      </Link>
                      <span className="block text-xs text-fb-muted">
                        {trip.vehicleName} · {trip.localStart.slice(11, 16)}–{trip.localEnd ? trip.localEnd.slice(11, 16) : ""} · {format.distance(trip.distanceKm, 1)}
                      </span>
                    </span>
                    <span className="flex gap-1.5">
                      {["business", "private", "commute"].map((category) => (
                        <button
                          key={category}
                          type="button"
                          disabled={busyTrip === trip.id}
                          onClick={() => assign(trip, category)}
                          className="min-h-9 rounded-lg border border-fb-border px-2.5 text-xs font-semibold hover:border-fb-accent disabled:opacity-50"
                        >
                          {t(`monthlyReport.categories.${category}`)}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              {totals.openTripCount > report.openTrips.length && (
                <p className="text-sm">{t("monthlyReport.open.more", { count: totals.openTripCount - report.openTrips.length })}</p>
              )}
              {report.olderOpenTripCount > 0 && (
                <p className="text-sm">{report.olderOpenTripCount === 1 ? t("monthlyReport.open.olderOne") : t("monthlyReport.open.older", { count: report.olderOpenTripCount })}</p>
              )}
            </section>
          ) : (
            <section id="open-trips" className="scroll-mt-24 rounded-xl bg-fb-accent-soft px-4 py-3.5 text-[15px] font-semibold text-fb-accent-strong">
              {t("monthlyReport.open.none")}
              {report.olderOpenTripCount > 0 && (
                <span className="font-normal"> {report.olderOpenTripCount === 1 ? t("monthlyReport.open.olderOne") : t("monthlyReport.open.older", { count: report.olderOpenTripCount })}</span>
              )}
            </section>
          )}

          {report.vehicles.length > 0 ? (
            <section className="space-y-3.5">
              <h2 className="text-lg font-bold">{t("monthlyReport.vehicles.title")}</h2>
              {report.vehicles.map((vehicle) => {
                const segments = segmentsOf(vehicle);
                const total = segments.reduce((sum, [, value]) => sum + value, 0);
                const owner = vehicle.access === "owner";
                const meta = [
                  vehicle.licensePlate,
                  owner
                    ? (vehicle.tripCount === 1 ? t("monthlyReport.vehicles.oneTrip") : t("monthlyReport.vehicles.trips", { count: vehicle.tripCount }))
                    : (vehicle.tripCount === 1 ? t("monthlyReport.vehicles.sharedOneTrip") : t("monthlyReport.vehicles.sharedTrips", { count: vehicle.tripCount })),
                  owner && vehicle.endOdometerKm != null ? t("monthlyReport.vehicles.odometer", { value: format.distance(vehicle.endOdometerKm) }) : null,
                ].filter(Boolean);
                return (
                  <div key={vehicle.id} className="space-y-2.5 rounded-xl border border-fb-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
                          {vehicle.name}
                          {!owner && (
                            <span className="rounded-full bg-fb-accent-soft px-2 py-0.5 text-xs font-semibold text-fb-accent-strong">
                              {vehicle.ownerName ? t("monthlyReport.vehicles.sharedBy", { name: vehicle.ownerName }) : t("monthlyReport.vehicles.shared")}
                            </span>
                          )}
                        </div>
                        <div className="text-[13px] text-fb-muted">{meta.join(" · ")}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-lg font-bold tabular-nums">{format.distance(vehicle.drivenKm)}</div>
                        {vehicle.openTripCount > 0
                          ? <div className="text-xs font-semibold text-fb-warn">{t("monthlyReport.vehicles.open", { count: vehicle.openTripCount })}</div>
                          : <div className="text-xs text-fb-muted">{t("monthlyReport.vehicles.done")}</div>}
                      </div>
                    </div>
                    <div role="img" aria-label={segments.map(([kind, value]) => `${categoryLabels[kind]} ${format.distance(value)}`).join(", ")} className="flex h-2.5 overflow-hidden rounded-full bg-fb-surface">
                      {segments.map(([kind, value]) => (
                        <div
                          key={kind}
                          style={{ width: `${value / total * 100}%`, ...(kind === "unexplained" ? { backgroundImage: HATCH } : { background: COLORS[kind] }) }}
                        />
                      ))}
                    </div>
                    {segments.length > 0 && (
                      <div className="text-[13px] leading-relaxed text-fb-muted">
                        {segments.map(([kind, value]) => `${categoryLabels[kind]} ${format.distanceNumber(value)}`).join(" · ")} {format.unit}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fb-muted">
                {Object.keys(legendLabels).filter((kind) => usedKinds.has(kind)).map((kind) => (
                  <span key={kind} className="inline-flex items-center gap-1.5"><Swatch kind={kind} />{legendLabels[kind]}</span>
                ))}
              </div>
            </section>
          ) : (
            <p className="text-sm text-fb-muted">{t("monthlyReport.vehicles.none")}</p>
          )}

          {report.newPlaces.length > 0 && (
            <section id="new-places" className="scroll-mt-24 space-y-3.5">
              <div>
                <h2 className="text-lg font-bold">
                  {report.newPlaces.length === 1
                    ? t("monthlyReport.places.titleOne", { month: monthName })
                    : t("monthlyReport.places.title", { count: report.newPlaces.length, month: monthName })}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-fb-muted">{t("monthlyReport.places.text", { month: monthName })}</p>
              </div>
              <ul className="divide-y divide-fb-border rounded-xl border border-fb-border">
                {report.newPlaces.map((place) => (
                  <li key={place.key} className={`px-4 py-3.5 ${requestedPlace === place.key ? "bg-fb-accent-soft/40" : ""}`}>
                    <div className="flex items-center gap-3.5">
                      <MapPinIcon aria-hidden="true" className="size-[22px] shrink-0 text-fb-accent-strong" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">
                          {place.address || t("monthlyReport.places.unknown")}
                          {place.savedPlace && <span className="font-normal text-fb-muted"> · „{place.savedPlace.name}“</span>}
                        </div>
                        <div className="text-xs text-fb-muted">{placeDetails(place)}</div>
                      </div>
                      {place.savedPlace ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-fb-muted">
                          <CheckIcon aria-hidden="true" className="size-4" />
                          {t("monthlyReport.places.saved")}
                        </span>
                      ) : openPlace !== place.key && (
                        <button type="button" onClick={() => setOpenPlace(place.key)} className="min-h-10 shrink-0 rounded-lg border border-fb-accent px-3.5 text-[13px] font-semibold text-fb-accent-strong hover:bg-fb-accent-soft">
                          {t("monthlyReport.places.save")}
                        </button>
                      )}
                    </div>
                    {openPlace === place.key && !place.savedPlace && (
                      <SavePlaceForm place={place} onCancel={() => setOpenPlace(null)} onSaved={() => { setOpenPlace(null); load(); }} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-fb-border pt-5">
            {mailAvailable && (
              <button type="button" onClick={sendNow} disabled={sendState.busy} className="h-11 rounded-lg border border-fb-border px-4 text-sm font-semibold hover:border-fb-accent disabled:opacity-60">
                {sendState.busy ? t("monthlyReport.sending") : t("monthlyReport.sendNow")}
              </button>
            )}
            <Link to="/profilesettings?tab=units#section-notifications" className="text-sm font-semibold text-fb-accent-strong hover:underline">{t("monthlyReport.settings")}</Link>
            {sendState.message && <span className="text-sm text-fb-accent-strong">{sendState.message}</span>}
            {sendState.error && <span role="alert" className="text-sm text-fb-danger">{sendState.error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
