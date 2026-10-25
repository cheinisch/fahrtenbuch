import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  getMapSettings,
  getSavedPlaces,
  getTrip,
  getTripMatchedRoute,
  getTripPoints,
  routeTripPath,
  saveTripRoute,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import AddressField from "../components/trips/AddressField.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useFeatures } from "../lib/features.jsx";
import { createMapStyle } from "../lib/mapStyle.js";
import { fromZonedInput, toZonedInput } from "../lib/zonedTime.js";

const EMPTY = { type: "FeatureCollection", features: [] };
const MAX_UNDO = 50;
const ROUTE_DEBOUNCE_MS = 700;

const fieldClass =
  "mt-1 block h-10 w-full rounded-lg border border-fb-border bg-fb-surface px-3 text-sm text-fb-text outline-none focus:border-fb-accent";
const smallButton =
  "min-h-9 rounded-lg border border-fb-border px-3 text-xs font-semibold hover:border-fb-accent disabled:opacity-50";

let nextKey = 1;
const withKey = (point) => ({ ...point, key: nextKey++ });

function meters(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += meters(points[i - 1], points[i]);
  return total;
}

/**
 * Wo ein neuer Punkt hingehört: an die Stelle, an der er die Strecke am wenigsten
 * verlängert (zwischen zwei Punkten, davor oder dahinter).
 */
function insertionIndex(points, point) {
  if (points.length === 0) return 0;
  if (points.length === 1) return 1;
  let bestIndex = points.length;
  let bestCost = meters(points.at(-1), point);
  const prepend = meters(point, points[0]);
  if (prepend < bestCost) { bestCost = prepend; bestIndex = 0; }
  for (let i = 0; i < points.length - 1; i++) {
    const cost = meters(points[i], point) + meters(point, points[i + 1]) - meters(points[i], points[i + 1]);
    if (cost < bestCost) { bestCost = cost; bestIndex = i + 1; }
  }
  return bestIndex;
}

function lineCollection(points) {
  return points.length >= 2
    ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) } }] }
    : EMPTY;
}

function pointCollection(points, selected) {
  return {
    type: "FeatureCollection",
    features: points.map((point, index) => ({
      type: "Feature",
      properties: {
        index,
        role: index === 0 ? "start" : index === points.length - 1 ? "end" : "point",
        selected: index === selected,
      },
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    })),
  };
}

/**
 * Fahrt-Editor: GPS-Punkte setzen, verschieben und löschen, Start/Ziel und Zeiten ändern.
 * Die Distanz wird laufend berechnet; mit Straßenführung werden Lücken zwischen den Punkten
 * über den Routing-Dienst gefüllt – jeder weitere Punkt lenkt die Route.
 */
export default function TripEditor() {
  const { id } = useParams();
  const { accessToken } = useAuth();
  const { t, locale } = useI18n();
  const { routingEnabled, geocodingEnabled } = useFeatures();
  const navigate = useNavigate();

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const pointsRef = useRef([]);
  const dragRef = useRef(null);
  const fittedRef = useRef(false);

  const [load, setLoad] = useState({ loading: true, error: "", trip: null, original: [], matched: [], mapSettings: null });
  const [points, setPoints] = useState([]);
  const [undo, setUndo] = useState([]);
  const [selected, setSelected] = useState(null);
  const [times, setTimes] = useState({ startDate: "", startTime: "", endDate: "", endTime: "" });
  const [startPlace, setStartPlace] = useState({ address: "", coordinate: null });
  const [endPlace, setEndPlace] = useState({ address: "", coordinate: null });
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [followRoads, setFollowRoads] = useState(true);
  const [routed, setRouted] = useState({ busy: false, error: "", result: null, forPoints: null });
  const [mapReady, setMapReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => { pointsRef.current = points; }, [points]);

  const zone = load.trip?.startTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const endZone = load.trip?.endTimeZone || zone;

  // Fahrt laden
  useEffect(() => {
    let active = true;
    Promise.all([
      getTrip(accessToken, id),
      getTripPoints(accessToken, id).catch(() => []),
      getTripMatchedRoute(accessToken, id).catch(() => null),
      getMapSettings(accessToken).catch(() => ({ provider: "osm" })),
    ])
      .then(([trip, rawPoints, matched, mapSettings]) => {
        if (!active) return;
        let original = (Array.isArray(rawPoints) ? rawPoints : []).map((point) => withKey({
          lat: Number(point.lat),
          lon: Number(point.lon),
          recordedAt: point.recordedAt || null,
          altitude: point.altitude ?? null,
          accuracy: point.accuracy ?? null,
          speed: point.speed ?? null,
          bearing: point.bearing ?? null,
        }));
        // Manuell angelegte Fahrt ohne Punkte: mit Start- und Zielkoordinate beginnen
        if (original.length === 0) {
          original = [
            trip.startLat != null ? withKey({ lat: Number(trip.startLat), lon: Number(trip.startLon), recordedAt: trip.startedAt }) : null,
            trip.endLat != null ? withKey({ lat: Number(trip.endLat), lon: Number(trip.endLon), recordedAt: trip.endedAt }) : null,
          ].filter(Boolean);
        }
        const tz = trip.startTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const start = toZonedInput(trip.startedAt, tz);
        const end = toZonedInput(trip.endedAt, trip.endTimeZone || tz);
        setTimes({ startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time });
        setStartPlace({ address: trip.startAddress || "", coordinate: null });
        setEndPlace({ address: trip.endAddress || "", coordinate: null });
        setPoints(original);
        setLoad({
          loading: false,
          error: "",
          trip,
          original,
          matched: (matched?.coordinates || []).map(([lat, lon]) => ({ lat: Number(lat), lon: Number(lon) })),
          mapSettings,
        });
      })
      .catch((error) => { if (active) setLoad((current) => ({ ...current, loading: false, error: error.message })); });
    getSavedPlaces(accessToken)
      .then((places) => { if (active) setSavedPlaces(Array.isArray(places) ? places : []); })
      .catch(() => {});
    return () => { active = false; };
  }, [accessToken, id]);

  const editable = load.trip?.status === "completed";

  const change = useCallback((updater) => {
    setUndo((stack) => [...stack.slice(-(MAX_UNDO - 1)), pointsRef.current]);
    setPoints((current) => (typeof updater === "function" ? updater(current) : updater));
    setDirty(true);
  }, []);

  const removePoint = useCallback((index) => {
    change((current) => current.filter((_, i) => i !== index));
    setSelected(null);
  }, [change]);

  const undoLast = useCallback(() => {
    if (!undo.length) return;
    setPoints(undo.at(-1));
    setUndo(undo.slice(0, -1));
    setSelected(null);
    setDirty(true);
  }, [undo]);

  // Karte anlegen
  useEffect(() => {
    if (!load.mapSettings || !containerRef.current || mapRef.current) return undefined;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#f48120";
    const settings = load.mapSettings;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createMapStyle(settings),
      center: [Number(settings.defaultLongitude ?? 10.45), Number(settings.defaultLatitude ?? 51.17)],
      zoom: Number(settings.defaultZoom ?? 5),
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      for (const source of ["matched", "path", "points"]) map.addSource(source, { type: "geojson", data: EMPTY });
      map.addLayer({ id: "matched", type: "line", source: "matched", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2563eb", "line-width": 4, "line-opacity": 0.35 } });
      map.addLayer({ id: "path", type: "line", source: "path", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": accent, "line-width": 4 } });
      map.addLayer({
        id: "points",
        type: "circle",
        source: "points",
        paint: {
          "circle-radius": ["case", ["get", "selected"], 8, ["!=", ["get", "role"], "point"], 7, ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 5]],
          "circle-color": ["match", ["get", "role"], "start", "#16a34a", "end", "#dc2626", "#ffffff"],
          "circle-stroke-color": ["case", ["get", "selected"], "#111827", accent],
          "circle-stroke-width": ["case", ["get", "selected"], 3, 2],
        },
      });
      setMapReady(true);
    });

    const pointIndex = (event) => {
      const feature = event.features?.[0];
      return feature ? Number(feature.properties.index) : null;
    };

    // Ziehen: beim Drücken auf einen Punkt die Kartenverschiebung aussetzen
    const startDrag = (event) => {
      const index = pointIndex(event);
      if (index == null) return;
      event.preventDefault();
      dragRef.current = { index, moved: false, snapshot: pointsRef.current };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
    };
    const moveDrag = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) {
        drag.moved = true;
        setUndo((stack) => [...stack.slice(-(MAX_UNDO - 1)), drag.snapshot]);
      }
      const { lng, lat } = event.lngLat;
      setPoints((current) => current.map((point, i) => (i === drag.index
        // Verschobener Punkt ist keine Messung mehr: Messwerte verwerfen, Zeit behalten
        ? { ...point, lat, lon: lng, accuracy: null, speed: null, bearing: null, altitude: null }
        : point)));
    };
    const endDrag = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      setSelected(drag.index);
      if (drag.moved) setDirty(true);
      // Klick ohne Bewegung soll keinen neuen Punkt erzeugen
      map.__skipClick = true;
      setTimeout(() => { map.__skipClick = false; }, 0);
    };

    map.on("mousedown", "points", startDrag);
    map.on("touchstart", "points", startDrag);
    map.on("mousemove", moveDrag);
    map.on("touchmove", moveDrag);
    map.on("mouseup", endDrag);
    map.on("touchend", endDrag);
    map.on("mouseenter", "points", () => { if (!dragRef.current) map.getCanvas().style.cursor = "grab"; });
    map.on("mouseleave", "points", () => { if (!dragRef.current) map.getCanvas().style.cursor = ""; });

    // Klick ins Leere: Punkt an der passenden Stelle der Strecke einfügen
    map.on("click", (event) => {
      if (map.__skipClick || map.__readOnly) return;
      const hits = map.queryRenderedFeatures(event.point, { layers: ["points"] });
      if (hits.length) return;
      const point = withKey({ lat: event.lngLat.lat, lon: event.lngLat.lng, recordedAt: null });
      const index = insertionIndex(pointsRef.current, point);
      setUndo((stack) => [...stack.slice(-(MAX_UNDO - 1)), pointsRef.current]);
      setPoints((current) => [...current.slice(0, index), point, ...current.slice(index)]);
      setSelected(index);
      setDirty(true);
    });

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    observer?.observe(containerRef.current);
    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [load.mapSettings]);

  // Nicht abgeschlossene Fahrten nur ansehen
  useEffect(() => {
    if (mapRef.current) mapRef.current.__readOnly = !editable;
  }, [editable, mapReady]);

  // Straßenführung: Lücken zwischen den Punkten über den Routing-Dienst füllen (verzögert)
  useEffect(() => {
    if (!routingEnabled || !followRoads || points.length < 2) {
      setRouted({ busy: false, error: "", result: null, forPoints: null });
      return undefined;
    }
    let cancelled = false;
    const snapshot = points;
    const timer = setTimeout(async () => {
      setRouted((current) => ({ ...current, busy: true, error: "" }));
      try {
        const result = await routeTripPath(accessToken, snapshot.map(({ lat, lon }) => ({ lat, lon })));
        if (!cancelled) setRouted({ busy: false, error: "", result, forPoints: snapshot });
      } catch (error) {
        if (!cancelled) setRouted({ busy: false, error: error.message, result: null, forPoints: null });
      }
    }, ROUTE_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [routingEnabled, followRoads, points, accessToken]);

  const routedCurrent = routed.result && routed.forPoints === points ? routed.result : null;
  const displayPath = routedCurrent ? routedCurrent.path : points;
  const distanceMeters = routedCurrent ? routedCurrent.distanceMeters : pathLength(points);

  // Zeichnen
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.getSource("matched")?.setData(lineCollection(load.matched));
    map.getSource("path")?.setData(lineCollection(displayPath));
    map.getSource("points")?.setData(pointCollection(points, selected));
  }, [mapReady, load.matched, displayPath, points, selected]);

  // Ausschnitt einmalig auf die Fahrt setzen
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || fittedRef.current || !load.trip) return;
    const all = [...points, ...load.matched];
    if (!all.length) return;
    const bounds = all.reduce((box, p) => box.extend([p.lon, p.lat]), new maplibregl.LngLatBounds([all[0].lon, all[0].lat], [all[0].lon, all[0].lat]));
    map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: window.innerWidth >= 768 ? 440 : 40, right: 60 }, maxZoom: 16, duration: 0 });
    fittedRef.current = true;
  }, [mapReady, load.trip, load.matched, points]);

  // Tastatur: Entf löscht den gewählten Punkt, Strg+Z macht rückgängig
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((event.key === "Delete" || event.key === "Backspace") && selected != null && editable) {
        event.preventDefault();
        removePoint(selected);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLast();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, editable, removePoint, undoLast]);

  // Vorschlag für Start/Ziel gewählt: ersten bzw. letzten Punkt dorthin setzen
  function placeEndpoint(which, value) {
    (which === "start" ? setStartPlace : setEndPlace)(value);
    setDirty(true);
    if (!value.coordinate) return;
    const point = withKey({ lat: value.coordinate.lat, lon: value.coordinate.lon, recordedAt: null });
    change((current) => {
      if (current.length === 0) return [point];
      if (current.length === 1) return which === "start" ? [point, current[0]] : [current[0], point];
      return which === "start"
        ? [{ ...point, recordedAt: current[0].recordedAt }, ...current.slice(1)]
        : [...current.slice(0, -1), { ...point, recordedAt: current.at(-1).recordedAt }];
    });
  }

  function updateTime(name, value) {
    setTimes((current) => {
      const next = { ...current, [name]: value };
      if (name === "startDate" && current.endDate === current.startDate) next.endDate = value;
      return next;
    });
    setDirty(true);
  }

  function resetPoints() {
    change(load.original);
    setSelected(null);
  }

  async function save() {
    setSaveError("");
    const startedAt = fromZonedInput(times.startDate, times.startTime, zone, load.trip.startedAt);
    const endedAt = fromZonedInput(times.endDate, times.endTime, endZone, load.trip.endedAt);
    if (!startedAt || !endedAt) { setSaveError(t("tripEditor.errors.time")); return; }
    if (endedAt <= startedAt) { setSaveError(t("tripEditor.errors.endBeforeStart")); return; }
    if (points.length < 2) { setSaveError(t("tripEditor.errors.tooFewPoints")); return; }

    // Mit Straßenführung die gerouteten Ergänzungen mitspeichern; eigene Punkte behalten ihre Daten
    const strip = ({ key, ...point }) => point;
    const payloadPoints = routedCurrent
      ? routedCurrent.path.map((entry) => (entry.index == null ? { lat: entry.lat, lon: entry.lon } : strip(points[entry.index])))
      : points.map(strip);
    setSaving(true);
    try {
      await saveTripRoute(accessToken, id, {
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        startAddress: startPlace.address.trim() || null,
        endAddress: endPlace.address.trim() || null,
        routedPointCount: routedCurrent ? routedCurrent.path.filter((entry) => entry.index == null).length : 0,
        points: payloadPoints,
      });
      navigate(`/?trip=${encodeURIComponent(id)}`);
    } catch (error) {
      setSaveError(error.message);
      setSaving(false);
    }
  }

  const km = (value) => (value / 1000).toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const selectedPoint = selected != null ? points[selected] : null;
  const backTo = `/?trip=${encodeURIComponent(id)}`;
  const timeLabel = useMemo(() => (value) => (value
    ? new Intl.DateTimeFormat(locale, { timeStyle: "medium", timeZone: zone }).format(new Date(value))
    : t("tripEditor.noTime")), [locale, zone, t]);

  return (
    <div className="relative h-[calc(100dvh-4.5rem-1px)] min-h-[320px] overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" aria-label={t("tripEditor.mapLabel")} />

      <aside className="absolute inset-x-3 bottom-3 z-10 max-h-[60%] overflow-y-auto rounded-xl border border-fb-border bg-fb-main/95 p-4 text-sm shadow-xl backdrop-blur md:bottom-4 md:left-4 md:right-auto md:top-4 md:max-h-none md:w-[400px]">
        <Link to={backTo} className="font-semibold text-fb-accent hover:underline">← {t("tripEditor.back")}</Link>
        <h1 className="mt-2 text-xl font-bold">{t("tripEditor.title")}</h1>

        {load.loading && <p className="mt-3 text-fb-muted">{t("tripEditor.loading")}</p>}
        {load.error && <p role="alert" className="mt-3 text-fb-danger">{load.error}</p>}

        {load.trip && (
          <div className="mt-3 space-y-4">
            {!editable && <p className="rounded-lg border border-fb-border p-3 text-fb-muted">{t("tripEditor.notCompleted")}</p>}

            <fieldset disabled={!editable || saving} className="space-y-3">
              <legend className="font-semibold">{t("tripEditor.startLegend")}</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-medium text-fb-muted">{t("tripEditor.date")}
                  <input type="date" required value={times.startDate} onChange={(e) => updateTime("startDate", e.target.value)} className={fieldClass} />
                </label>
                <label className="text-xs font-medium text-fb-muted">{t("tripEditor.time")}
                  <input type="time" required value={times.startTime} onChange={(e) => updateTime("startTime", e.target.value)} className={fieldClass} />
                </label>
              </div>
              <AddressField id="editor-start" label={t("tripEditor.address")} value={startPlace} onChange={(value) => placeEndpoint("start", value)}
                savedPlaces={savedPlaces} accessToken={accessToken} geocodingEnabled={geocodingEnabled} fieldClass={fieldClass} hideStatus />
            </fieldset>

            <fieldset disabled={!editable || saving} className="space-y-3">
              <legend className="font-semibold">{t("tripEditor.endLegend")}</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-medium text-fb-muted">{t("tripEditor.date")}
                  <input type="date" required min={times.startDate} value={times.endDate} onChange={(e) => updateTime("endDate", e.target.value)} className={fieldClass} />
                </label>
                <label className="text-xs font-medium text-fb-muted">{t("tripEditor.time")}
                  <input type="time" required value={times.endTime} onChange={(e) => updateTime("endTime", e.target.value)} className={fieldClass} />
                </label>
              </div>
              <AddressField id="editor-end" label={t("tripEditor.address")} value={endPlace} onChange={(value) => placeEndpoint("end", value)}
                savedPlaces={savedPlaces} accessToken={accessToken} geocodingEnabled={geocodingEnabled} fieldClass={fieldClass} hideStatus />
              {zone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
                <p className="text-xs text-fb-muted">{t("tripEditor.zoneHint", { zone })}</p>
              )}
            </fieldset>

            <section className="space-y-2 border-t border-fb-border pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">{t("tripEditor.routeTitle")}</h2>
                <span className="text-lg font-bold">{km(distanceMeters)} km</span>
              </div>
              <p className="text-xs text-fb-muted">
                {t("tripEditor.stats", { points: points.length, previous: km(Number(load.trip.distanceKm || 0) * 1000) })}
              </p>
              {routingEnabled ? (
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={followRoads} disabled={!editable} onChange={(e) => setFollowRoads(e.target.checked)} className="mt-0.5" />
                  <span>
                    {t("tripEditor.followRoads")}
                    <span className="block text-xs text-fb-muted">
                      {routed.busy
                        ? t("tripEditor.routing")
                        : routed.error
                          ? routed.error
                          : routedCurrent
                            ? t("tripEditor.routedInfo", { routed: routedCurrent.routedGaps, gaps: routedCurrent.gapCount, failed: routedCurrent.failedGaps })
                            : t("tripEditor.followRoadsHint")}
                    </span>
                  </span>
                </label>
              ) : (
                <p className="text-xs text-fb-muted">{t("tripEditor.noRouting")}</p>
              )}
              {editable && <p className="text-xs text-fb-muted">{t("tripEditor.hint")}</p>}
            </section>

            {selectedPoint && (
              <section className="space-y-2 rounded-lg border border-fb-border bg-fb-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {selected === 0 ? t("tripEditor.pointStart") : selected === points.length - 1 ? t("tripEditor.pointEnd") : t("tripEditor.pointNumber", { number: selected + 1, total: points.length })}
                  </span>
                  <button type="button" onClick={() => setSelected(null)} className="text-xs text-fb-muted hover:text-fb-accent">{t("common.close")}</button>
                </div>
                <p className="text-xs text-fb-muted">
                  {timeLabel(selectedPoint.recordedAt)} · {selectedPoint.lat.toFixed(5)}, {selectedPoint.lon.toFixed(5)}
                  {selectedPoint.accuracy != null ? ` · ±${Math.round(selectedPoint.accuracy)} m` : ""}
                </p>
                {editable && (
                  <button type="button" onClick={() => removePoint(selected)} className={smallButton}>{t("tripEditor.removePoint")}</button>
                )}
              </section>
            )}

            {editable && (
              <div className="flex flex-wrap gap-2 border-t border-fb-border pt-4">
                <button type="button" onClick={undoLast} disabled={!undo.length || saving} className={smallButton}>{t("tripEditor.undo")}</button>
                <button type="button" onClick={resetPoints} disabled={saving || points === load.original} className={smallButton}>{t("tripEditor.reset")}</button>
                <div className="ml-auto flex gap-2">
                  <Link to={backTo} className="inline-flex min-h-10 items-center rounded-lg border border-fb-border px-3 font-semibold hover:border-fb-accent">{t("common.cancel")}</Link>
                  <button type="button" onClick={save} disabled={saving || !dirty || points.length < 2 || routed.busy} className="min-h-10 rounded-lg bg-fb-accent px-4 font-semibold text-fb-accent-text disabled:opacity-50">
                    {saving ? t("common.saving") : t("tripEditor.save")}
                  </button>
                </div>
              </div>
            )}
            {saveError && <p role="alert" className="text-fb-danger">{saveError}</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
