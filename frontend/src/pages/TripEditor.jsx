import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  getDawarichConnection,
  getMapSettings,
  getSavedPlaces,
  getTrip,
  getTripMatchedRoute,
  getTripPoints,
  importTripPointsFromDawarich,
  reverseGeocode,
  routeTripPath,
  saveTripRoute,
} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import GapNotice from "../components/tripEditor/GapNotice.jsx";
import { BackIcon } from "../components/tripEditor/icons.jsx";
import LayersPanel from "../components/tripEditor/LayersPanel.jsx";
import MapToolbar from "../components/tripEditor/MapToolbar.jsx";
import RoadToggle from "../components/tripEditor/RoadToggle.jsx";
import SelectedPointCard from "../components/tripEditor/SelectedPointCard.jsx";
import StartEndCompact from "../components/tripEditor/StartEndCompact.jsx";
import StartEndSection from "../components/tripEditor/StartEndSection.jsx";
import StatCards from "../components/tripEditor/StatCards.jsx";
import TripTimeline from "../components/tripEditor/TripTimeline.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useFeatures } from "../lib/features.jsx";
import { createMapStyle } from "../lib/mapStyle.js";
import { estimateTimes, gpsGaps, insertionIndex, pathLength } from "../lib/tripTimes.js";
import { fromZonedInput, toZonedInput } from "../lib/zonedTime.js";

const EMPTY = { type: "FeatureCollection", features: [] };
const MAX_HISTORY = 50;
const ROUTE_DEBOUNCE_MS = 700;
// Ab dieser Länge erscheint der Lücken-Hinweis
const NOTICE_GAP_MS = 10 * 60_000;
// Abstand (Pixel) zur Linie, ab dem „hier einfügen“ erscheint
const GHOST_RADIUS_PX = 10;
const ACCENT = "#0ea5e9";

let nextKey = 1;
const withKey = (point) => ({ ...point, key: nextKey++ });

function lineCollection(points) {
  return points.length >= 2
    ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) } }] }
    : EMPTY;
}

function pointCollection(points, selected) {
  const last = points.length - 1;
  return {
    type: "FeatureCollection",
    features: points.map((point, index) => ({
      type: "Feature",
      properties: {
        index,
        role: index === 0 ? "start" : index === last ? "end" : point.origin,
        selected: index === selected,
      },
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    })),
  };
}

function fromApiPoint(point) {
  return withKey({
    lat: Number(point.lat),
    lon: Number(point.lon),
    recordedAt: point.recordedAt || null,
    altitude: point.altitude ?? null,
    accuracy: point.accuracy ?? null,
    speed: point.speed ?? null,
    bearing: point.bearing ?? null,
    origin: "gps",
  });
}

/** Nächster Punkt auf einem Segment (Bildschirmkoordinaten). */
function nearestOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const tRaw = length ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / length : 0;
  const t = Math.max(0, Math.min(1, tRaw));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { x, y, t, distance: Math.hypot(p.x - x, p.y - y) };
}

/**
 * Fahrt-Editor: Punkte setzen, verschieben und löschen, Start/Ziel mit Zeiten und Adressen
 * ändern. Die Distanz wird laufend berechnet; mit Straßenführung werden Lücken zwischen den
 * Punkten über den Routing-Dienst gefüllt – jeder weitere Punkt lenkt die Route.
 */
export default function TripEditor() {
  const { id } = useParams();
  const { accessToken } = useAuth();
  const { t, locale, language } = useI18n();
  const { routingEnabled, geocodingEnabled } = useFeatures();
  const navigate = useNavigate();

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const pointsRef = useRef([]);
  const toolRef = useRef("select");
  const displayRef = useRef([]);
  const dragRef = useRef(null);
  const fittedRef = useRef(false);
  const nearbyCache = useRef(new Map());

  const [reloadKey, setReloadKey] = useState(0);
  const [load, setLoad] = useState({ loading: true, error: "", trip: null, initial: null, matched: [], mapSettings: null });
  const [points, setPoints] = useState([]);
  const [history, setHistory] = useState({ undo: [], redo: [] });
  const [selected, setSelected] = useState(null);
  const [times, setTimes] = useState({ startDate: "", startTime: "", endDate: "", endTime: "" });
  const [startPlace, setStartPlace] = useState({ address: "", coordinate: null });
  const [endPlace, setEndPlace] = useState({ address: "", coordinate: null });
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [dawarich, setDawarich] = useState({ connected: false, busy: false });
  const [tool, setTool] = useState("select");
  const [layers, setLayers] = useState({ route: true, raw: true, matched: false });
  const [followRoads, setFollowRoads] = useState(true);
  const [routed, setRouted] = useState({ busy: false, error: "", result: null, forPoints: null });
  const [mapReady, setMapReady] = useState(false);
  const [ghost, setGhost] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [nearby, setNearby] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => { pointsRef.current = points; }, [points]);
  useEffect(() => { toolRef.current = tool; setGhost(null); }, [tool]);

  const trip = load.trip;
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone = trip?.startTimeZone || browserZone;
  const endZone = trip?.endTimeZone || zone;
  const editable = trip?.status === "completed";

  // Fahrt laden (auch nach dem Dawarich-Import erneut)
  useEffect(() => {
    let active = true;
    setLoad((current) => ({ ...current, loading: true, error: "" }));
    Promise.all([
      getTrip(accessToken, id),
      getTripPoints(accessToken, id).catch(() => []),
      getTripMatchedRoute(accessToken, id).catch(() => null),
      getMapSettings(accessToken).catch(() => ({ provider: "osm" })),
    ])
      .then(([loaded, rawPoints, matched, mapSettings]) => {
        if (!active) return;
        let initialPoints = (Array.isArray(rawPoints) ? rawPoints : []).map(fromApiPoint);
        // Manuell angelegte Fahrt ohne Punkte: mit Start- und Zielkoordinate beginnen
        if (initialPoints.length === 0) {
          initialPoints = [
            loaded.startLat != null ? withKey({ lat: Number(loaded.startLat), lon: Number(loaded.startLon), recordedAt: loaded.startedAt, origin: "set" }) : null,
            loaded.endLat != null ? withKey({ lat: Number(loaded.endLat), lon: Number(loaded.endLon), recordedAt: loaded.endedAt, origin: "set" }) : null,
          ].filter(Boolean);
        }
        const tz = loaded.startTimeZone || browserZone;
        const start = toZonedInput(loaded.startedAt, tz);
        const end = toZonedInput(loaded.endedAt, loaded.endTimeZone || tz);
        const initial = {
          points: initialPoints,
          times: { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time },
          startAddress: loaded.startAddress || "",
          endAddress: loaded.endAddress || "",
        };
        setPoints(initial.points);
        setTimes(initial.times);
        setStartPlace({ address: initial.startAddress, coordinate: null });
        setEndPlace({ address: initial.endAddress, coordinate: null });
        setHistory({ undo: [], redo: [] });
        setSelected(null);
        fittedRef.current = false;
        setLoad({
          loading: false,
          error: "",
          trip: loaded,
          initial,
          matched: (matched?.coordinates || []).map(([lat, lon]) => ({ lat: Number(lat), lon: Number(lon) })),
          mapSettings,
        });
      })
      .catch((error) => { if (active) setLoad((current) => ({ ...current, loading: false, error: error.message })); });
    return () => { active = false; };
  }, [accessToken, id, reloadKey, browserZone]);

  useEffect(() => {
    let active = true;
    getSavedPlaces(accessToken).then((places) => { if (active) setSavedPlaces(Array.isArray(places) ? places : []); }).catch(() => {});
    getDawarichConnection(accessToken).then((value) => { if (active) setDawarich((d) => ({ ...d, connected: value?.connected === true })); }).catch(() => {});
    return () => { active = false; };
  }, [accessToken]);

  // Punkte ändern mit Rückgängig/Wiederholen
  const change = useCallback((updater) => {
    const before = pointsRef.current;
    const after = typeof updater === "function" ? updater(before) : updater;
    if (after === before) return;
    setHistory((h) => ({ undo: [...h.undo.slice(-(MAX_HISTORY - 1)), before], redo: [] }));
    setPoints(after);
  }, []);

  // Rückgängig/Wiederholen über eine Ref, damit State-Updater frei von Nebenwirkungen bleiben
  const historyRef = useRef(history);
  useEffect(() => { historyRef.current = history; }, [history]);
  const stepHistory = useCallback((direction) => {
    const h = historyRef.current;
    const from = direction === "undo" ? h.undo : h.redo;
    if (!from.length) return;
    const target = from.at(-1);
    const next = direction === "undo"
      ? { undo: h.undo.slice(0, -1), redo: [...h.redo, pointsRef.current] }
      : { undo: [...h.undo, pointsRef.current], redo: h.redo.slice(0, -1) };
    historyRef.current = next;
    setHistory(next);
    setPoints(target);
    setSelected(null);
  }, []);
  const undo = useCallback(() => stepHistory("undo"), [stepHistory]);
  const redo = useCallback(() => stepHistory("redo"), [stepHistory]);

  const removePoint = useCallback((index) => {
    change((current) => current.filter((_, i) => i !== index));
    setSelected(null);
  }, [change]);

  const insertPoint = useCallback((lat, lon, atIndex = null) => {
    const point = withKey({ lat, lon, recordedAt: null, origin: "set" });
    const index = atIndex ?? insertionIndex(pointsRef.current, point);
    change((current) => [...current.slice(0, index), point, ...current.slice(index)]);
    setSelected(index);
  }, [change]);

  // Zeiten aus den Feldern
  const startMs = useMemo(() => fromZonedInput(times.startDate, times.startTime, zone, trip?.startedAt)?.getTime() ?? NaN, [times.startDate, times.startTime, zone, trip?.startedAt]);
  const endMs = useMemo(() => fromZonedInput(times.endDate, times.endTime, endZone, trip?.endedAt)?.getTime() ?? NaN, [times.endDate, times.endTime, endZone, trip?.endedAt]);
  const pointTimes = useMemo(() => estimateTimes(points, startMs, endMs), [points, startMs, endMs]);
  const gaps = useMemo(() => gpsGaps(points, startMs, endMs), [points, startMs, endMs]);
  const biggestGap = useMemo(() => gaps.reduce((best, gap) => (!best || gap.to - gap.from > best.to - best.from ? gap : best), null), [gaps]);

  // Straßenführung: Lücken über den Routing-Dienst füllen (verzögert)
  useEffect(() => {
    if (!routingEnabled || !followRoads || points.length < 2) {
      setRouted((current) => (current.result || current.busy || current.error ? { busy: false, error: "", result: null, forPoints: null } : current));
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
  const displayPath = useMemo(
    () => (routedCurrent ? routedCurrent.path : points.map((point, index) => ({ lat: point.lat, lon: point.lon, index }))),
    [routedCurrent, points],
  );
  useEffect(() => { displayRef.current = displayPath; }, [displayPath]);
  const distanceMeters = routedCurrent ? routedCurrent.distanceMeters : pathLength(points);

  // Karte anlegen
  useEffect(() => {
    if (!load.mapSettings || !containerRef.current || mapRef.current) return undefined;
    const settings = load.mapSettings;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createMapStyle(settings),
      center: [Number(settings.defaultLongitude ?? 10.45), Number(settings.defaultLatitude ?? 51.17)],
      zoom: Number(settings.defaultZoom ?? 5),
    });
    mapRef.current = map;

    map.on("load", () => {
      for (const source of ["matched", "raw", "path", "points"]) map.addSource(source, { type: "geojson", data: EMPTY });
      map.addLayer({ id: "matched", type: "line", source: "matched", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2563eb", "line-width": 5, "line-opacity": 0.35 } });
      map.addLayer({ id: "raw", type: "line", source: "raw", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#9ca3af", "line-width": 2, "line-opacity": 0.7, "line-dasharray": [2, 2] } });
      map.addLayer({ id: "path", type: "line", source: "path", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ACCENT, "line-width": 5 } });
      map.addLayer({ id: "points-halo", type: "circle", source: "points", filter: ["==", ["get", "selected"], true], paint: { "circle-radius": 16, "circle-color": ACCENT, "circle-opacity": 0.25 } });
      map.addLayer({
        id: "points",
        type: "circle",
        source: "points",
        paint: {
          // MapLibre erlaubt "zoom" nur im obersten interpolate: Größen je Rolle an beiden Stützstellen
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            8, ["case", ["get", "selected"], 9, ["match", ["get", "role"], ["start", "end"], 11, "set", 7, 3]],
            14, ["case", ["get", "selected"], 9, ["match", ["get", "role"], ["start", "end"], 11, "set", 7, 5]],
          ],
          "circle-color": ["match", ["get", "role"], "start", "#16a34a", "end", "#dc2626", "set", ACCENT, "#ffffff"],
          "circle-stroke-color": ["match", ["get", "role"], "gps", ACCENT, "#ffffff"],
          "circle-stroke-width": ["case", ["get", "selected"], 3, ["match", ["get", "role"], ["start", "end"], 3, 2]],
        },
      });
      setMapReady(true);
    });

    const pointIndex = (event) => {
      const feature = event.features?.[0];
      return feature ? Number(feature.properties.index) : null;
    };

    const startDrag = (event) => {
      if (map.__readOnly) return;
      const index = pointIndex(event);
      if (index == null) return;
      event.preventDefault();
      if (toolRef.current === "delete") {
        dragRef.current = { index, moved: false, deleteOnly: true };
        return;
      }
      dragRef.current = { index, moved: false, snapshot: pointsRef.current };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
      setGhost(null);
    };
    const moveDrag = (event) => {
      const drag = dragRef.current;
      if (!drag || drag.deleteOnly) return;
      if (!drag.moved) {
        drag.moved = true;
        setHistory((h) => ({ undo: [...h.undo.slice(-(MAX_HISTORY - 1)), drag.snapshot], redo: [] }));
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
      if (drag.deleteOnly) {
        removePointRef.current?.(drag.index);
      } else {
        setSelected(drag.index);
      }
      // Der folgende Klick gehört zum Ziehen, nicht zum Einfügen
      map.__skipClick = true;
      setTimeout(() => { map.__skipClick = false; }, 50);
    };

    map.on("mousedown", "points", startDrag);
    map.on("touchstart", "points", startDrag);
    map.on("mousemove", moveDrag);
    map.on("touchmove", moveDrag);
    map.on("mouseup", endDrag);
    map.on("touchend", endDrag);
    map.on("mouseenter", "points", () => { if (!dragRef.current) map.getCanvas().style.cursor = toolRef.current === "delete" ? "not-allowed" : "grab"; });
    map.on("mouseleave", "points", () => { if (!dragRef.current) map.getCanvas().style.cursor = ""; });

    // „+ hier einfügen“: beim Überfahren der Linie im Auswahlwerkzeug
    let frame = null;
    map.on("mousemove", (event) => {
      if (dragRef.current || toolRef.current !== "select" || map.__readOnly) return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (map.queryRenderedFeatures(event.point, { layers: ["points"] }).length) { setGhost(null); return; }
        const path = displayRef.current;
        let best = null;
        let previous = path.length ? map.project([path[0].lon, path[0].lat]) : null;
        for (let i = 1; i < path.length; i++) {
          const current = map.project([path[i].lon, path[i].lat]);
          const hit = nearestOnSegment(event.point, previous, current);
          if (hit.distance <= GHOST_RADIUS_PX && (!best || hit.distance < best.distance)) best = { ...hit, segment: i - 1 };
          previous = current;
        }
        if (!best) { setGhost(null); return; }
        // Einfügen hinter dem letzten eigenen Punkt vor diesem Segment
        let after = -1;
        for (let j = best.segment; j >= 0; j--) if (path[j].index != null) { after = path[j].index; break; }
        const lngLat = map.unproject([best.x, best.y]);
        setGhost({ x: best.x, y: best.y, lat: lngLat.lat, lon: lngLat.lng, at: after + 1 });
      });
    });
    map.getCanvas().addEventListener("mouseleave", () => setGhost(null));

    map.on("click", (event) => {
      if (map.__skipClick || map.__readOnly) return;
      if (map.queryRenderedFeatures(event.point, { layers: ["points"] }).length) return;
      const activeTool = toolRef.current;
      if (activeTool === "add") {
        insertRef.current?.(event.lngLat.lat, event.lngLat.lng);
      } else if (activeTool === "select") {
        const current = ghostRef.current;
        if (current) insertRef.current?.(current.lat, current.lon, current.at);
        else setSelected(null);
      }
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

  // Handler-Refs, damit die Karten-Events immer die aktuelle Fassung aufrufen
  const insertRef = useRef(insertPoint);
  const removePointRef = useRef(removePoint);
  const ghostRef = useRef(ghost);
  useEffect(() => { insertRef.current = insertPoint; }, [insertPoint]);
  useEffect(() => { removePointRef.current = removePoint; }, [removePoint]);
  useEffect(() => { ghostRef.current = ghost; }, [ghost]);
  useEffect(() => { if (mapRef.current) mapRef.current.__readOnly = !editable; }, [editable, mapReady]);

  // Zeichnen
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.getSource("matched")?.setData(layers.matched ? lineCollection(load.matched) : EMPTY);
    map.getSource("raw")?.setData(layers.raw ? lineCollection((load.initial?.points || []).filter((p) => p.origin === "gps")) : EMPTY);
    map.getSource("path")?.setData(layers.route ? lineCollection(displayPath) : EMPTY);
    map.getSource("points")?.setData(pointCollection(points, selected));
  }, [mapReady, layers, load.matched, load.initial, displayPath, points, selected]);

  const fitTo = useCallback((list, animate = true) => {
    const map = mapRef.current;
    if (!map || !list.length) return;
    const bounds = list.reduce((box, p) => box.extend([p.lon, p.lat]), new maplibregl.LngLatBounds([list[0].lon, list[0].lat], [list[0].lon, list[0].lat]));
    const mobile = window.innerWidth < 768;
    map.fitBounds(bounds, {
      padding: mobile ? { top: 80, bottom: 420, left: 30, right: 70 } : { top: 90, bottom: 190, left: 60, right: 200 },
      maxZoom: 16,
      duration: animate ? 500 : 0,
    });
  }, []);

  useEffect(() => {
    if (!mapReady || fittedRef.current || !trip) return;
    const all = [...points, ...load.matched];
    if (!all.length) return;
    fitTo(all, false);
    fittedRef.current = true;
  }, [mapReady, trip, points, load.matched, fitTo]);

  // Hinweis am gewählten Punkt mitführen
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || selected == null || !points[selected]) { setTooltip(null); return undefined; }
    const update = () => {
      const p = pointsRef.current[selected];
      if (p) setTooltip(map.project([p.lon, p.lat]));
    };
    update();
    map.on("move", update);
    return () => map.off("move", update);
  }, [mapReady, selected, points]);

  // „Nähe“ des gewählten Punkts (verzögert, zwischengespeichert)
  useEffect(() => {
    const point = selected != null ? points[selected] : null;
    if (!point || !geocodingEnabled) { setNearby(""); return undefined; }
    const cacheKey = `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
    if (nearbyCache.current.has(cacheKey)) { setNearby(nearbyCache.current.get(cacheKey)); return undefined; }
    setNearby("");
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = (await reverseGeocode(accessToken, point.lat, point.lon, language))?.result;
        const text = [result?.raw?.street || result?.name, result?.city].filter(Boolean).join(", ") || result?.address || "";
        nearbyCache.current.set(cacheKey, text);
        if (!cancelled) setNearby(text);
      } catch { /* ohne Ortsangabe weiter */ }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selected, points, geocodingEnabled, accessToken, language]);

  // Tastatur: Entf löscht, Strg+Z / Strg+Y bzw. Strg+Umschalt+Z
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const key = event.key.toLowerCase();
      if ((event.key === "Delete" || event.key === "Backspace") && selected != null && editable) {
        event.preventDefault();
        removePoint(selected);
      } else if ((event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        redo();
      } else if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        undo();
      } else if (event.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, editable, removePoint, undo, redo]);

  // Adressvorschlag gewählt: ersten bzw. letzten Punkt dorthin setzen
  function placeEndpoint(which, value) {
    (which === "start" ? setStartPlace : setEndPlace)(value);
    if (!value.coordinate) return;
    const point = withKey({ lat: value.coordinate.lat, lon: value.coordinate.lon, recordedAt: null, origin: "set" });
    change((current) => {
      if (current.length === 0) return [point];
      if (current.length === 1) return which === "start" ? [point, current[0]] : [current[0], point];
      return which === "start" ? [point, ...current.slice(1)] : [...current.slice(0, -1), point];
    });
  }

  function updateTime(name, value) {
    setTimes((current) => {
      const next = { ...current, [name]: value };
      if (name === "startDate" && current.endDate === current.startDate) next.endDate = value;
      return next;
    });
  }

  function makeStart(index) {
    change((current) => current.slice(index));
    setSelected(0);
  }

  // Ungespeicherte Änderungen: Punkt-Schritte plus geänderte Felder
  const initial = load.initial;
  const fieldChanges = initial
    ? ["startDate", "startTime", "endDate", "endTime"].filter((key) => times[key] !== initial.times[key]).length
      + (startPlace.address !== initial.startAddress ? 1 : 0) + (endPlace.address !== initial.endAddress ? 1 : 0)
    : 0;
  const changeCount = history.undo.length + fieldChanges;
  const dirty = changeCount > 0 || (initial && points !== initial.points);

  function discard() {
    if (!initial) return;
    if (dirty && !window.confirm(t("tripEditor.discardConfirm"))) return;
    setPoints(initial.points);
    setTimes(initial.times);
    setStartPlace({ address: initial.startAddress, coordinate: null });
    setEndPlace({ address: initial.endAddress, coordinate: null });
    setHistory({ undo: [], redo: [] });
    setSelected(null);
    setSaveError("");
  }

  async function fillFromDawarich() {
    if (dirty && !window.confirm(t("tripEditor.dawarichConfirm"))) return;
    setDawarich((d) => ({ ...d, busy: true }));
    setSaveError("");
    try {
      const result = await importTripPointsFromDawarich(accessToken, id);
      if (result.importedCount === 0) setSaveError(t("tripEditor.dawarichNothing"));
      setReloadKey((value) => value + 1);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setDawarich((d) => ({ ...d, busy: false }));
    }
  }

  function jumpToGap() {
    if (!biggestGap) return;
    const inside = points.filter((_, i) => pointTimes[i] != null && pointTimes[i] >= biggestGap.from - 60_000 && pointTimes[i] <= biggestGap.to + 60_000);
    fitTo(inside.length ? inside : points);
  }

  async function save() {
    setSaveError("");
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) { setSaveError(t("tripEditor.errors.time")); return; }
    if (endMs <= startMs) { setSaveError(t("tripEditor.errors.endBeforeStart")); return; }
    if (points.length < 2) { setSaveError(t("tripEditor.errors.tooFewPoints")); return; }
    // Mit Straßenführung die gerouteten Ergänzungen mitspeichern; eigene Punkte behalten ihre Daten
    const strip = ({ key, origin, ...point }) => point;
    const payloadPoints = routedCurrent
      ? routedCurrent.path.map((entry) => (entry.index == null ? { lat: entry.lat, lon: entry.lon } : strip(points[entry.index])))
      : points.map(strip);
    setSaving(true);
    try {
      await saveTripRoute(accessToken, id, {
        startedAt: new Date(startMs).toISOString(),
        endedAt: new Date(endMs).toISOString(),
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

  // Anzeige-Hilfen
  const formatTime = useCallback((ms, withSeconds = false) => (Number.isFinite(ms)
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}), timeZone: zone }).format(new Date(ms))
    : "–"), [locale, zone]);
  const backTo = `/?trip=${encodeURIComponent(id)}`;
  const gpsCount = points.filter((p) => p.origin === "gps").length;
  const setCount = points.length - gpsCount;
  const previousMeters = Number(trip?.distanceKm || 0) * 1000;
  const durationSeconds = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 1000)) : 0;
  const selectedPoint = selected != null ? points[selected] : null;
  const selectedEstimated = selectedPoint ? !(selectedPoint.origin === "gps" && selectedPoint.recordedAt) : false;
  const selectedTime = selectedPoint ? `${formatTime(pointTimes[selected], !selectedEstimated)} ${t("tripEditor.oclock")}` : "";
  const subtitle = trip
    ? [new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: zone }).format(new Date(trip.startedAt)),
      trip.vehicleName, t(`dashboard.tripTypes.${trip.type}`)].filter(Boolean).join(" · ")
    : "";
  const roadStatus = !routingEnabled
    ? t("tripEditor.noRouting")
    : !followRoads
      ? t("tripEditor.roadsOff")
      : routed.busy
        ? t("tripEditor.routing")
        : routed.error
          ? routed.error
          : routedCurrent
            ? (routedCurrent.gapCount === 0
              ? t("tripEditor.noRoadGaps")
              : t("tripEditor.routedInfo", { routed: routedCurrent.routedGaps, gaps: routedCurrent.gapCount, provider: { atlas: "Atlas", valhalla: "Valhalla", osrm: "OSRM" }[routedCurrent.provider] || routedCurrent.provider }))
            : t("tripEditor.followRoadsHint");
  const canSave = editable && dirty && points.length >= 2 && !routed.busy && !saving;
  const selectedCardProps = selectedPoint && {
    index: selected,
    total: points.length,
    point: selectedPoint,
    timeText: selectedTime,
    estimated: selectedEstimated,
    nearby,
    editable,
    onClose: () => setSelected(null),
    onRemove: () => removePoint(selected),
    onMakeStart: () => makeStart(selected),
  };
  const startEndProps = {
    times,
    onTime: updateTime,
    startPlace,
    endPlace,
    onPlace: placeEndpoint,
    savedPlaces,
    accessToken,
    geocodingEnabled,
    disabled: !editable || saving,
  };
  const unsavedBadge = changeCount > 0 && (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-fb-warn-soft px-2.5 py-1 text-xs font-semibold text-fb-warn">
      <span className="size-[7px] rounded-full bg-fb-warn" />
      {t(changeCount === 1 ? "tripEditor.unsavedOne" : "tripEditor.unsaved", { count: changeCount })}
    </span>
  );
  const kbd = "rounded border border-fb-border px-1.5 py-px font-[inherit]";

  return (
    <div className="flex h-[calc(100dvh-4.5rem-1px)] min-h-[320px] flex-col">
      {/* Bearbeitungsleiste (Desktop) */}
      <div className="hidden shrink-0 flex-wrap items-center gap-4 border-b border-[#2c2c2c] bg-[#181818] px-6 py-3.5 md:flex">
        <Link to={backTo} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-fb-accent-strong no-underline hover:underline">
          <BackIcon width={16} height={16} />{t("tripEditor.back")}
        </Link>
        <div className="h-7 w-px bg-fb-border" />
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-bold">{t("tripEditor.title")}</h1>
          <div className="text-[13px] text-fb-muted">{subtitle}</div>
        </div>
        {unsavedBadge}
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={discard} disabled={!dirty || saving} className="min-h-11 rounded-[10px] border border-fb-border px-4 font-semibold disabled:opacity-50">{t("tripEditor.discard")}</button>
          <button type="button" onClick={save} disabled={!canSave} className="min-h-11 rounded-[10px] bg-[#0369a1] px-5 font-semibold text-white disabled:opacity-50">
            {saving ? t("common.saving") : t("tripEditor.save")}
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Seitenleiste (Desktop) */}
        <aside className="hidden w-[400px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-[#2c2c2c] bg-fb-main p-5 md:flex">
          {load.loading && !trip && <p className="text-fb-muted">{t("tripEditor.loading")}</p>}
          {load.error && <p role="alert" className="text-fb-danger">{load.error}</p>}
          {trip && (
            <>
              {!editable && <p className="rounded-lg border border-fb-border p-3 text-fb-muted">{t("tripEditor.notCompleted")}</p>}
              <StartEndSection {...startEndProps} />
              <StatCards distanceMeters={distanceMeters} previousMeters={previousMeters} durationSeconds={durationSeconds} gpsCount={gpsCount} setCount={setCount} />
              {biggestGap && biggestGap.to - biggestGap.from >= NOTICE_GAP_MS && (
                <GapNotice gap={biggestGap} formatTime={formatTime} routed={Boolean(routedCurrent?.routedGaps)}
                  dawarichAvailable={dawarich.connected && editable} dawarichBusy={dawarich.busy} onDawarich={fillFromDawarich} onJump={jumpToGap} />
              )}
              <section aria-labelledby="editor-roads" className="flex flex-col gap-2.5">
                <h2 id="editor-roads" className="text-xs font-semibold uppercase tracking-[0.06em] text-fb-muted">{t("tripEditor.routePlanning")}</h2>
                <RoadToggle checked={followRoads && routingEnabled} disabled={!routingEnabled || !editable} onChange={setFollowRoads} status={roadStatus} />
              </section>
              {selectedCardProps && <SelectedPointCard {...selectedCardProps} />}
              {saveError && <p role="alert" className="text-sm text-fb-danger">{saveError}</p>}
              {editable && (
                <p className="mt-auto text-xs leading-normal text-fb-muted">
                  {t("tripEditor.hintClick")} · {t("tripEditor.hintDrag")} · <kbd className={kbd}>Entf</kbd> {t("tripEditor.hintDelete")} · <kbd className={kbd}>Strg Z</kbd> {t("tripEditor.hintUndo")}
                </p>
              )}
            </>
          )}
        </aside>

        {/* Karte */}
        <main className="relative min-w-0 flex-1 overflow-hidden bg-[#1a1f24]">
          <div ref={containerRef} className="absolute inset-0" aria-label={t("tripEditor.mapLabel")} />

          <div className="absolute left-1/2 top-4 z-10 hidden -translate-x-1/2 md:block">
            <MapToolbar tool={tool} onTool={setTool} canUndo={history.undo.length > 0} canRedo={history.redo.length > 0}
              onUndo={undo} onRedo={redo} onFit={() => fitTo([...points, ...load.matched])} editable={editable} />
          </div>
          <div className="absolute right-4 top-4 z-10 hidden md:block">
            <LayersPanel layers={layers} onChange={setLayers} hasMatched={load.matched.length > 1} />
          </div>

          {ghost && (
            <div className="pointer-events-none absolute z-10" style={{ left: ghost.x, top: ghost.y }}>
              <span className="absolute -left-1.5 -top-1.5 size-3 rounded-full border-2 border-dashed border-fb-accent-strong bg-[#1a1f24]" />
              <span className="absolute left-3 -top-6 whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-[#bae6fd]">{t("tripEditor.insertHere")}</span>
            </div>
          )}

          {tooltip && selectedPoint && (
            <div className="pointer-events-none absolute z-10 hidden w-[220px] rounded-[10px] border border-fb-accent bg-fb-main px-3 py-2.5 text-xs leading-[1.45] shadow-[0_8px_24px_rgba(0,0,0,0.45)] md:block"
              style={{ left: tooltip.x + 16, top: tooltip.y - 70 }}>
              <div className="font-semibold text-fb-text">{t("tripEditor.tooltipTitle", { number: selected + 1, time: `${selectedEstimated ? "≈ " : ""}${selectedTime}` })}</div>
              <div className="text-fb-muted">{t("tripEditor.tooltipHint")}</div>
            </div>
          )}

          {trip && (
            <div className="absolute inset-x-4 bottom-4 z-10 hidden md:block">
              <TripTimeline points={points} times={pointTimes} startMs={startMs} endMs={endMs} gaps={gaps} selected={selected}
                onSelect={(index) => { setSelected(index); fitTo([points[index]]); }} formatTime={formatTime} />
            </div>
          )}

          {/* Handy: Kopfzeile, Werkzeuge, Panel */}
          <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 md:hidden">
            <Link to={backTo} aria-label={t("tripEditor.back")} className="inline-flex size-11 items-center justify-center rounded-xl border border-fb-border bg-fb-main text-fb-text">
              <BackIcon />
            </Link>
            <div className="flex h-11 min-w-0 flex-1 flex-col justify-center rounded-xl border border-fb-border bg-fb-main px-3">
              <div className="text-sm font-semibold">{t("tripEditor.title")}</div>
              {changeCount > 0 && <div className="text-[11px] text-fb-warn">{t(changeCount === 1 ? "tripEditor.unsavedOne" : "tripEditor.unsaved", { count: changeCount })}</div>}
            </div>
          </div>
          <div className="absolute right-3 top-[72px] z-10 md:hidden">
            <MapToolbar vertical showDelete={false} showRedo={false} showFit={false} tool={tool} onTool={setTool}
              canUndo={history.undo.length > 0} canRedo={false} onUndo={undo} onRedo={redo} onFit={() => {}} editable={editable} />
          </div>

          {trip && (
            <div className="absolute inset-x-0 bottom-0 z-20 flex max-h-[55%] flex-col gap-3 overflow-y-auto rounded-t-[20px] border-t border-fb-border bg-fb-main px-4 pb-4 pt-2.5 shadow-[0_-12px_32px_rgba(0,0,0,0.45)] md:hidden">
              <span className="h-1 w-10 shrink-0 self-center rounded-sm bg-[#4a4a4a]" />
              {selectedCardProps && <SelectedPointCard {...selectedCardProps} compact />}
              <StatCards compact distanceMeters={distanceMeters} previousMeters={previousMeters} durationSeconds={durationSeconds} gpsCount={gpsCount} setCount={setCount} />
              <StartEndCompact {...startEndProps} />
              <RoadToggle framed={false} checked={followRoads && routingEnabled} disabled={!routingEnabled || !editable} onChange={setFollowRoads} status={roadStatus} />
              {saveError && <p role="alert" className="text-sm text-fb-danger">{saveError}</p>}
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                <button type="button" onClick={discard} disabled={!dirty || saving} className="min-h-12 rounded-xl border border-fb-border font-semibold disabled:opacity-50">{t("tripEditor.discard")}</button>
                <button type="button" onClick={save} disabled={!canSave} className="min-h-12 rounded-xl bg-[#0369a1] font-semibold text-white disabled:opacity-50">
                  {saving ? t("common.saving") : t("tripEditor.save")}
                </button>
              </div>
            </div>
          )}
          {load.error && <p role="alert" className="absolute inset-x-3 top-20 z-10 rounded-lg border border-fb-danger bg-fb-main p-3 text-fb-danger md:hidden">{load.error}</p>}
        </main>
      </div>
    </div>
  );
}
