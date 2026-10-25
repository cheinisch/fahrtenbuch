import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  correctTripRoute,
  getMapSettings,
  getTrip,
  getTripMatchedRoute,
  getTripPoints,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { createMapStyle } from "../lib/mapStyle.js";

const EMPTY = { type: "FeatureCollection", features: [] };
// Beim Übernehmen der GPS-Spur höchstens so viele Stützpunkte, damit die Route bearbeitbar bleibt
const MAX_PREFILL_POINTS = 150;
// Klick in diesem Abstand (Pixel) auf einen Stützpunkt entfernt ihn statt einen neuen zu setzen
const HIT_RADIUS_PX = 12;

function line(coordinates) {
  return coordinates.length >= 2
    ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }] }
    : EMPTY;
}

function pointsCollection(coordinates, extra = () => ({})) {
  return {
    type: "FeatureCollection",
    features: coordinates.map((coordinate, index) => ({
      type: "Feature",
      properties: { index, ...extra(index) },
      geometry: { type: "Point", coordinates: coordinate },
    })),
  };
}

function sample(points, maximum) {
  if (points.length <= maximum) return points;
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * step)]);
}

function formatDateTime(value, locale, timeZone) {
  if (!value) return "–";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) })
    .format(new Date(value));
}

function draftLengthKm(points) {
  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    const [lon1, lat1] = points[i - 1];
    const [lon2, lat2] = points[i];
    const rad = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
    meters += 2 * 6_371_000 * Math.asin(Math.sqrt(a));
  }
  return meters / 1000;
}

/**
 * Eigene Seite für die Routenkorrektur einer Fahrt: große Karte mit GPS-Spur und
 * Straßenroute, darauf die neue Route Punkt für Punkt setzen.
 */
export default function TripRoute() {
  const { id } = useParams();
  const { accessToken } = useAuth();
  const { t, locale } = useI18n();
  const navigate = useNavigate();

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const draftRef = useRef([]);
  const [state, setState] = useState({ loading: true, error: "", trip: null, points: [], matched: [], mapSettings: null });
  const [draft, setDraft] = useState([]);
  const [mapReady, setMapReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => { draftRef.current = draft; }, [draft]);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    Promise.all([
      getTrip(accessToken, id),
      getTripPoints(accessToken, id).catch(() => []),
      getTripMatchedRoute(accessToken, id).catch(() => null),
      getMapSettings(accessToken).catch(() => ({ provider: "osm" })),
    ])
      .then(([trip, points, matched, mapSettings]) => {
        if (!active) return;
        setState({
          loading: false,
          error: "",
          trip,
          points: (Array.isArray(points) ? points : []).map((point) => [Number(point.lon), Number(point.lat)]),
          // Straßenroute kommt als [lat, lon]
          matched: (matched?.coordinates || []).map(([lat, lon]) => [Number(lon), Number(lat)]),
          mapSettings,
        });
      })
      .catch((error) => { if (active) setState((current) => ({ ...current, loading: false, error: error.message })); });
    return () => { active = false; };
  }, [accessToken, id]);

  // Karte einmal anlegen, sobald die Kartenvorgaben da sind
  useEffect(() => {
    if (!state.mapSettings || !containerRef.current || mapRef.current) return undefined;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#f48120";
    const settings = state.mapSettings;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createMapStyle(settings),
      center: [Number(settings.defaultLongitude ?? 10.45), Number(settings.defaultLatitude ?? 51.17)],
      zoom: Number(settings.defaultZoom ?? 5),
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.getCanvas().style.cursor = "crosshair";

    map.on("load", () => {
      map.addSource("gps", { type: "geojson", data: EMPTY });
      map.addSource("matched", { type: "geojson", data: EMPTY });
      map.addSource("draft", { type: "geojson", data: EMPTY });
      map.addSource("draft-points", { type: "geojson", data: EMPTY });
      map.addSource("endpoints", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "matched", type: "line", source: "matched", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2563eb", "line-width": 4, "line-opacity": 0.55 } });
      map.addLayer({ id: "gps", type: "line", source: "gps", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#6b7280", "line-width": 3, "line-opacity": 0.8 } });
      map.addLayer({ id: "draft", type: "line", source: "draft", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": accent, "line-width": 5, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "draft-points", type: "circle", source: "draft-points", paint: { "circle-radius": ["case", ["get", "edge"], 7, 5], "circle-color": accent, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "endpoints", type: "circle", source: "endpoints", paint: { "circle-radius": 7, "circle-color": ["match", ["get", "kind"], "start", "#16a34a", "#dc2626"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      setMapReady(true);
    });

    map.on("click", (event) => {
      const current = draftRef.current;
      // Klick auf einen vorhandenen Stützpunkt entfernt ihn
      const hit = current.findIndex((coordinate) => {
        const projected = map.project(coordinate);
        return Math.hypot(projected.x - event.point.x, projected.y - event.point.y) <= HIT_RADIUS_PX;
      });
      if (hit >= 0) setDraft(current.filter((_, index) => index !== hit));
      else setDraft([...current, [event.lngLat.lng, event.lngLat.lat]]);
    });

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    observer?.observe(containerRef.current);
    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [state.mapSettings]);

  // Fahrtdaten zeichnen und Ausschnitt anpassen
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !state.trip) return;
    map.getSource("gps")?.setData(line(state.points));
    map.getSource("matched")?.setData(line(state.matched));
    const trip = state.trip;
    const endpoints = [];
    const start = state.points[0] || (trip.startLon != null ? [trip.startLon, trip.startLat] : null);
    const end = state.points.at(-1) || (trip.endLon != null ? [trip.endLon, trip.endLat] : null);
    if (start) endpoints.push({ type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: start } });
    if (end) endpoints.push({ type: "Feature", properties: { kind: "end" }, geometry: { type: "Point", coordinates: end } });
    map.getSource("endpoints")?.setData({ type: "FeatureCollection", features: endpoints });

    const all = [...state.points, ...state.matched, ...endpoints.map((feature) => feature.geometry.coordinates)];
    if (all.length) {
      const bounds = all.reduce((box, coordinate) => box.extend(coordinate), new maplibregl.LngLatBounds(all[0], all[0]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
    }
  }, [mapReady, state.trip, state.points, state.matched]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.getSource("draft")?.setData(line(draft));
    map.getSource("draft-points")?.setData(pointsCollection(draft, (index) => ({ edge: index === 0 || index === draft.length - 1 })));
  }, [mapReady, draft]);

  const draftKm = useMemo(() => draftLengthKm(draft), [draft]);
  const backTo = `/?trip=${encodeURIComponent(id)}`;

  function prefill(source) {
    setDraft(sample(source, MAX_PREFILL_POINTS));
  }

  async function save() {
    if (draft.length < 2) return;
    if (!window.confirm(t("tripRoute.confirmSave", { points: draft.length }))) return;
    setSaving(true);
    setSaveError("");
    try {
      await correctTripRoute(accessToken, id, draft.map(([longitude, latitude]) => ({ latitude, longitude })));
      navigate(backTo);
    } catch (error) {
      setSaveError(error.message);
      setSaving(false);
    }
  }

  const trip = state.trip;
  const zone = trip?.startTimeZone || undefined;
  const number = (value) => value.toLocaleString(locale, { maximumFractionDigits: 1 });

  return (
    <div className="relative h-[calc(100dvh-4.5rem-1px)] min-h-[320px] overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" aria-label={t("tripRoute.mapLabel")} />

      <aside className="absolute inset-x-3 bottom-3 z-10 max-h-[60%] overflow-y-auto rounded-xl border border-fb-border bg-fb-main/95 p-4 shadow-xl backdrop-blur md:bottom-auto md:left-4 md:right-auto md:top-4 md:max-h-[calc(100%-2rem)] md:w-[380px]">
        <Link to={backTo} className="text-sm font-semibold text-fb-accent hover:underline">← {t("tripRoute.back")}</Link>
        <h1 className="mt-2 text-xl font-bold">{t("tripRoute.title")}</h1>

        {state.loading && <p className="mt-3 text-sm text-fb-muted">{t("tripRoute.loading")}</p>}
        {state.error && <p role="alert" className="mt-3 text-sm text-fb-danger">{state.error}</p>}

        {trip && (
          <>
            <dl className="mt-3 space-y-1 text-sm">
              <div><dt className="inline text-fb-muted">{t("tripRoute.start")}: </dt><dd className="inline">{formatDateTime(trip.startedAt, locale, zone)}{trip.startAddress ? ` · ${trip.startAddress}` : ""}</dd></div>
              <div><dt className="inline text-fb-muted">{t("tripRoute.end")}: </dt><dd className="inline">{formatDateTime(trip.endedAt, locale, trip.endTimeZone || zone)}{trip.endAddress ? ` · ${trip.endAddress}` : ""}</dd></div>
              <div><dt className="inline text-fb-muted">{t("tripRoute.distance")}: </dt><dd className="inline">{trip.distanceKm != null ? `${number(Number(trip.distanceKm))} km` : "–"} · {t("tripRoute.gpsPoints", { count: state.points.length })}</dd></div>
            </dl>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fb-muted">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-1 w-4 rounded bg-[#6b7280]" />{t("tripRoute.legendGps")}</span>
              {state.matched.length > 1 && <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-1 w-4 rounded bg-[#2563eb]" />{t("tripRoute.legendMatched")}</span>}
              <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-1 w-4 rounded bg-fb-accent" />{t("tripRoute.legendDraft")}</span>
            </div>

            {trip.status !== "completed" ? (
              <p className="mt-4 text-sm text-fb-muted">{t("tripRoute.notCompleted")}</p>
            ) : (
              <section className="mt-4 space-y-3 border-t border-fb-border pt-4">
                <p className="text-sm text-fb-muted">{t("tripRoute.hint")}</p>
                <div className="flex flex-wrap gap-2">
                  {state.points.length > 1 && (
                    <button type="button" onClick={() => prefill(state.points)} className="min-h-9 rounded-lg border border-fb-border px-3 text-xs font-semibold hover:border-fb-accent">{t("tripRoute.prefillGps")}</button>
                  )}
                  {state.matched.length > 1 && (
                    <button type="button" onClick={() => prefill(state.matched)} className="min-h-9 rounded-lg border border-fb-border px-3 text-xs font-semibold hover:border-fb-accent">{t("tripRoute.prefillMatched")}</button>
                  )}
                </div>
                <p className="text-sm">
                  {t("tripRoute.draftInfo", { points: draft.length, km: number(draftKm) })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={draft.length === 0} onClick={() => setDraft((points) => points.slice(0, -1))} className="min-h-10 rounded-lg border border-fb-border px-3 text-sm disabled:opacity-50">{t("dashboard.routeCorrection.removeLast")}</button>
                  <button type="button" disabled={draft.length === 0} onClick={() => setDraft([])} className="min-h-10 rounded-lg border border-fb-border px-3 text-sm disabled:opacity-50">{t("tripRoute.clear")}</button>
                  <button type="button" disabled={draft.length < 2 || saving} onClick={save} className="min-h-10 rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text disabled:opacity-50">
                    {saving ? t("common.saving") : t("dashboard.routeCorrection.save")}
                  </button>
                </div>
                {saveError && <p role="alert" className="text-sm text-fb-danger">{saveError}</p>}
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
