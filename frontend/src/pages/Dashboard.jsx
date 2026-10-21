
import maplibregl from "maplibre-gl";
import { layers, namedFlavor } from "@protomaps/basemaps";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getDashboard,
  getPersonalSettings,
  getTripHistory,
  getTripPoints,
  mergeTrips,
  splitTrip,
  getTripSuggestions,
  correctTripRoute,
  getAssignableTripDrivers,
  assignTripDriver,
  archiveTrip,
  getArchivedTrips,
  restoreArchivedTrip,
  permanentlyDeleteTrip,
  classifyTrip,
  updateTripTags,

} from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useSearchParams } from "react-router-dom";

import { useI18n } from "../i18n/I18nProvider.jsx";
import { codeKey, translate } from "../i18n/translate.js";
import { routeColor } from "../lib/routeColors.js";

const OSM_MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "/api/v1/map/osm/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: `© ${translate("dashboard.osmContributors")}`,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

function resolveProtomapsFlavor(value) {
  if (value && value !== "auto") {
    return value;
  }

  // Kontoeinstellung (data-theme) vor der Systemeinstellung berücksichtigen.
  const forcedTheme = document.documentElement.dataset.theme;
  if (forcedTheme === "dark" || forcedTheme === "light") {
    return forcedTheme;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function createMapStyle(settings) {
  if (settings?.provider !== "protomaps") {
    return OSM_MAP_STYLE;
  }

  const flavorName = resolveProtomapsFlavor(
    settings.protomapsFlavor,
  );

  return {
    version: 8,
    glyphs:
      "/api/v1/map/protomaps/fonts/{fontstack}/{range}.pbf",
    sprite:
      `/api/v1/map/protomaps/sprites/v4/${flavorName}`,
    sources: {
      protomaps: {
        type: "vector",
        url: "/api/v1/map/protomaps/tilejson",
        attribution:
          `Protomaps © ${translate("dashboard.osmContributors")}`,
      },
    },
    layers: layers(
      "protomaps",
      namedFlavor(flavorName),
      // Beschriftungssprache der Karte folgt der Oberflächensprache (vom I18nProvider in <html lang> gesetzt).
      { lang: document.documentElement.lang || "de" },
    ),
  };
}


function tripTypeLabel(t, type) {
  return t(`dashboard.tripTypes.${type}`) || type;
}

function specialCategoryLabel(t, category) {
  return category ? (t(`dashboard.specialCategories.${category}`) || category) : "";
}

function historyEventLabel(t, eventType) {
  return t(`dashboard.historyEvents.${codeKey(eventType)}`, eventType);
}

function historyFieldLabel(t, field) {
  return t(`dashboard.historyFields.${codeKey(field)}`, field);
}

function historySummary(entry, t) {
  const fields = Object.keys(entry.changedFields || {})
    .filter((field) => !["updated_at", "version"].includes(field))
    .map((field) => historyFieldLabel(t, field));

  if (fields.length === 0) {
    return "";
  }

  return fields.slice(0, 4).join(", ") +
    (fields.length > 4 ? ` +${fields.length - 4}` : "");
}

const SPECIAL_CATEGORIES = ["medical", "volunteer", "education", "application", "moving", "other"];
const TRIP_TYPES = ["business", "private", "commute", "unclassified"];

function formatDistance(meters, locale = "de-DE") {
  return `${(
    Number(meters || 0) / 1000
  ).toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} km`;
}

// Fahrtzeiten in der Zone anzeigen, in der die Fahrt stattfand (start_timezone),
// nicht in der Zone des Browsers.
function formatDate(value, locale = "de-DE", timeZone) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "–";
  const options = { dateStyle: "medium", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat(locale, timeZone ? { ...options, timeZone } : options).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

function routeTitle(trip, t) {
  // Nur den Ort zeigen: letzter Adressteil ohne Postleitzahl.
  const short = (address, fallback) =>
    address ? address.split(",").pop().trim().replace(/^\d{4,5}\s+/, "") || address : fallback;
  return `${short(trip.startAddress, t("dashboard.unknownStart"))} → ${short(trip.endAddress, t("dashboard.unknownDestination"))}`;
}

function toLineFeatures(trips, t) {
  return trips
    .filter((trip) => trip.route.length >= 2)
    .map((trip) => ({
      type: "Feature",
      id: trip.id,
      properties: {
        tripId: trip.id,
        type: trip.type,
        label: tripTypeLabel(t, trip.type),
        startedAt: trip.startedAt,
      },
      geometry: {
        type: "LineString",
        coordinates: trip.route.map((point) => [
          point.longitude,
          point.latitude,
        ]),
      },
    }));
}

function toEndpointFeatures(trips) {
  const features = [];

  for (const trip of trips) {
    if (trip.route.length === 0) {
      continue;
    }

    const start = trip.route[0];
    const end =
      trip.route[trip.route.length - 1];

    features.push({
      type: "Feature",
      properties: {
        tripId: trip.id,
        pointType: "start",
      },
      geometry: {
        type: "Point",
        coordinates: [
          start.longitude,
          start.latitude,
        ],
      },
    });

    if (
      start.latitude !== end.latitude ||
      start.longitude !== end.longitude
    ) {
      features.push({
        type: "Feature",
        properties: {
          tripId: trip.id,
          pointType: "end",
        },
        geometry: {
          type: "Point",
          coordinates: [
            end.longitude,
            end.latitude,
          ],
        },
      });
    }
  }

  return features;
}

function collectCoordinates(trips) {
  return trips.flatMap((trip) =>
    trip.route.map((point) => [
      point.longitude,
      point.latitude,
    ]),
  );
}

const FRAMING_RADIUS_KM = 300;

function distanceKm([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Ausschnitt für die Übersicht: Einzelne GPS-Ausreißer (z. B. Emulator-Standort
// oder Sprünge beim Fix) sollen die Karte nicht auf Weltansicht zoomen. Gezeigt
// wird der Bereich um den Median der Fahrten; gezeichnet werden weiterhin alle Punkte.
function framingCoordinates(trips) {
  const all = collectCoordinates(trips);
  const midpoints = trips
    .filter((trip) => trip.route.length > 0)
    .map((trip) => {
      const point = trip.route[Math.floor(trip.route.length / 2)];
      return [point.longitude, point.latitude];
    });
  if (midpoints.length < 3) {
    return all;
  }
  const center = [median(midpoints.map((c) => c[0])), median(midpoints.map((c) => c[1]))];
  const nearby = all.filter((coordinate) => distanceKm(coordinate, center) <= FRAMING_RADIUS_KM);
  return nearby.length > 0 ? nearby : all;
}

function createBounds(coordinates) {
  if (coordinates.length === 0) {
    return null;
  }

  const bounds = new maplibregl.LngLatBounds(
    coordinates[0],
    coordinates[0],
  );

  for (const coordinate of coordinates.slice(1)) {
    bounds.extend(coordinate);
  }

  return bounds;
}

// Auf dem Desktop liegen Fahrtenliste (links) und Detailpanel (rechts) über
// der Karte; beim Einpassen der Route deren Breite freihalten.
function mapPadding(detailsOpen, base) {
  if (!window.matchMedia?.("(min-width: 768px)").matches) {
    return base;
  }
  return { top: base, bottom: base, left: 440 + base / 2, right: detailsOpen ? 450 + base / 2 : base };
}

function pointCoordinates(point) {
  const longitude = Number(point?.longitude ?? point?.lon);
  const latitude = Number(point?.latitude ?? point?.lat);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? [longitude, latitude]
    : null;
}

export default function Dashboard() {
  const { accessToken } = useAuth();
  const { t, locale } = useI18n();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedTrips, setArchivedTrips] = useState([]);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!archiveOpen) return;
    let active = true;
    getArchivedTrips(accessToken).then((items) => { if (active) setArchivedTrips(items); }).catch((e) => { if (active) setArchiveError(e.message); });
    return () => { active = false; };
  }, [archiveOpen, accessToken, reloadKey]);

  async function changeTrip(id, operation) {
    if (archiveBusy) return;
    const message = operation === 'archive' ? t('tripArchive.confirmArchive') : operation === 'delete' ? t('tripArchive.confirmDelete') : null;
    if (message && !window.confirm(message)) return;
    setArchiveBusy(true);
    setArchiveError('');
    try {
      if (operation === 'archive') await archiveTrip(accessToken, id);
      if (operation === 'restore') await restoreArchivedTrip(accessToken, id);
      if (operation === 'delete') await permanentlyDeleteTrip(accessToken, id);
      setSelectedTripId(null);
      setReloadKey((n) => n + 1);
    } catch (e) { setArchiveError(e.message); }
    finally { setArchiveBusy(false); }
  }


  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const mapLoadedRef = useRef(false);
  const selectedTripIdRef = useRef(null);
  const mapModeRef = useRef(null);
  const splitPointsRef = useRef([]);
  // Der Karten-Klick-Handler wird nur einmal registriert; über die Ref sieht er
  // nach einem Token-Refresh trotzdem das aktuelle Token.
  const accessTokenRef = useRef(accessToken);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);

  const [filters, setFilters] = useState({
    from: "",
    to: "",
    type: "",
    specialCategory: "",
    tagId: "",
  });

  const [data, setData] = useState({
    trips: [],
    filters: {
      tags: [],
    },
    map: {
      homeLocation: null,
      workLocation: null,
      locationRecognitionRadiusMeters: 250,
      settings: null,
    },
  });

  const [mapError, setMapError] = useState("");
  const [routeColors, setRouteColors] = useState({});
  useEffect(() => {
    let active = true;
    getPersonalSettings(accessToken).then((result) => {
      if (active) setRouteColors(result.settings?.mapRouteColors || {});
    }).catch(() => {});
    return () => { active = false; };
  }, [accessToken]);
  const [selectedForMerge, setSelectedForMerge] = useState([]);
  const [mobilePanel, setMobilePanel] = useState("map");
  const [mobileDetailsExpanded, setMobileDetailsExpanded] = useState(false);
  const [tripAction, setTripAction] = useState({ busy: false, error: "", splitPoints: null });
  const [suggestions, setSuggestions] = useState([]);
  const [mapMode, setMapMode] = useState(null);
  const [hoveredSplitPointId, setHoveredSplitPointId] = useState(null);
  const [selectedSplitPointId, setSelectedSplitPointId] = useState(null);
  const [routeDraft, setRouteDraft] = useState([]);
  const [driverAssignment, setDriverAssignment] = useState({ loading: false, drivers: [], selected: "", reason: "" });

  const [selectedTripId, setSelectedTripId] =
    useState(null);

  const [detailsTab, setDetailsTab] = useState("details");
  const [gpsMode, setGpsMode] = useState("route");
  const [gpsPoints, setGpsPoints] = useState([]);
  const [gpsError, setGpsError] = useState("");
  const [editCategory, setEditCategory] = useState("unclassified");
  const [editSpecialCategory, setEditSpecialCategory] = useState("");
  const [editTags, setEditTags] = useState([]);
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [history, setHistory] = useState({
    loading: false,
    error: "",
    entries: [],
  });

  const selectedTrip = data.trips.find((trip) => trip.id === selectedTripId) || null;

  useEffect(() => { selectedTripIdRef.current = selectedTripId; }, [selectedTripId]);
  useEffect(() => { mapModeRef.current = mapMode; }, [mapMode]);
  useEffect(() => { splitPointsRef.current = tripAction.splitPoints || []; }, [tripAction.splitPoints]);

  const [status, setStatus] = useState({
    loading: true,
    error: "",
  });

  // A selected trip is the only trip rendered on the map.
  const visibleTrips = useMemo(
    () => selectedTripId
      ? data.trips.filter((trip) => trip.id === selectedTripId)
      : data.trips,
    [data.trips, selectedTripId],
  );

  const lineFeatures = useMemo(() => {
    if (selectedTripId && gpsMode === "points") return [];
    // Originalroute: Linie nur aus den GPS-Rohpunkten statt der Straßenroute
    if (selectedTripId && gpsMode === "original" && gpsPoints.length >= 2) {
      const raw = gpsPoints
        .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
        .map((p) => ({ latitude: Number(p.lat), longitude: Number(p.lon) }));
      return toLineFeatures(visibleTrips.map((trip) => ({ ...trip, route: raw })), t);
    }
    return toLineFeatures(visibleTrips, t);
  }, [visibleTrips, selectedTripId, gpsMode, gpsPoints, t]);

  const endpointFeatures = useMemo(
    () => toEndpointFeatures(visibleTrips),
    [visibleTrips],
  );

  const fitAllTrips = useCallback(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const coordinates = framingCoordinates(
      visibleTrips,
    );

    if (coordinates.length === 1) {
      map.easeTo({
        center: coordinates[0],
        zoom: 13,
        duration: 500,
      });
      return;
    }

    const bounds = createBounds(coordinates);

    if (bounds) {
      map.fitBounds(bounds, {
        padding: mapPadding(Boolean(selectedTripIdRef.current), 70),
        maxZoom: 15,
        duration: 500,
      });
      return;
    }

    const homeLocation = data.map.homeLocation;
    const fallbackLocation =
      homeLocation || data.map.workLocation;

    if (fallbackLocation) {
      map.easeTo({
        center: [
          fallbackLocation.longitude,
          fallbackLocation.latitude,
        ],
        zoom: 12,
        duration: 500,
      });
      return;
    }

    map.easeTo({
      center: [10.4515, 51.1657],
      zoom: 5,
      duration: 500,
    });
  }, [data.map.homeLocation, data.map.workLocation, visibleTrips]);

  const updateMapData = useCallback(() => {
    const map = mapRef.current;

    if (!map || !mapLoadedRef.current) {
      return;
    }

    const routeSource =
      map.getSource("trip-routes");

    routeSource?.setData({
      type: "FeatureCollection",
      features: lineFeatures,
    });

    map.getSource("trip-gps-points")?.setData({
      type: "FeatureCollection",
      features: selectedTripId && (gpsMode === "both" || gpsMode === "points")
        ? gpsPoints.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))).map((p) => ({
          type: "Feature", properties: { recordedAt: p.recordedAt },
          geometry: { type: "Point", coordinates: [Number(p.lon), Number(p.lat)] },
        }))
        : [],
    });

    const splitCandidates = mapMode === "split"
      ? (tripAction.splitPoints || []).map((point) => {
          const coordinates = pointCoordinates(point);
          return coordinates ? {
            type: "Feature",
            properties: { pointId: String(point.id) },
            geometry: { type: "Point", coordinates },
          } : null;
        }).filter(Boolean)
      : [];

    map.getSource("split-candidates")?.setData({
      type: "FeatureCollection",
      features: splitCandidates,
    });

    const highlightedSplitPointId = hoveredSplitPointId ?? selectedSplitPointId;
    const hoveredSplitPoint = (tripAction.splitPoints || []).find(
      (point) => String(point.id) === String(highlightedSplitPointId),
    );
    const hoveredCoordinates = pointCoordinates(hoveredSplitPoint);
    map.getSource("split-highlight")?.setData({
      type: "FeatureCollection",
      features: hoveredCoordinates ? [{
        type: "Feature",
        properties: { pointId: String(hoveredSplitPoint.id) },
        geometry: { type: "Point", coordinates: hoveredCoordinates },
      }] : [],
    });

    const pointSource =
      map.getSource("trip-endpoints");

    pointSource?.setData({
      type: "FeatureCollection",
      features: endpointFeatures,
    });

    const homeLocation =
      data.map.homeLocation;

    const homeSource =
      map.getSource("home-location");

    homeSource?.setData({
      type: "FeatureCollection",
      features: homeLocation
        ? [
            {
              type: "Feature",
              properties: {
                label: homeLocation.address,
              },
              geometry: {
                type: "Point",
                coordinates: [
                  homeLocation.longitude,
                  homeLocation.latitude,
                ],
              },
            },
          ]
        : [],
    });

    const workLocation = data.map.workLocation;
    const workSource = map.getSource("work-location");

    workSource?.setData({
      type: "FeatureCollection",
      features: workLocation
        ? [
            {
              type: "Feature",
              properties: {
                label: workLocation.address,
              },
              geometry: {
                type: "Point",
                coordinates: [
                  workLocation.longitude,
                  workLocation.latitude,
                ],
              },
            },
          ]
        : [],
    });

    map.setPaintProperty("trip-routes", "line-color", [
      "match", ["get", "type"],
      "private", routeColor("private", routeColors),
      "business", routeColor("business", routeColors),
      "commute", routeColor("commute", routeColors),
      "unclassified", routeColor("unclassified", routeColors),
      routeColor("unclassified", routeColors),
    ]);

    map.setPaintProperty(
      "trip-routes",
      "line-width",
      [
        "case",
        [
          "==",
          ["get", "tripId"],
          selectedTripId || "",
        ],
        6,
        4,
      ],
    );

    map.setPaintProperty(
      "trip-routes",
      "line-opacity",
      [
        "case",
        [
          "==",
          ["get", "tripId"],
          selectedTripId || "",
        ],
        1,
        0.72,
      ],
    );
  }, [
    data.map.homeLocation,
    data.map.workLocation,
    endpointFeatures,
    lineFeatures,
    gpsMode,
    gpsPoints,
    selectedTripId,
    routeColors,
    mapMode,
    tripAction.splitPoints,
    hoveredSplitPointId,
    selectedSplitPointId,
  ]);

  useEffect(() => {
    if (
      !mapContainerRef.current ||
      mapRef.current
    ) {
      return;
    }

    const rootStyles = getComputedStyle(
      document.documentElement,
    );

    const accent =
      rootStyles
        .getPropertyValue("--color-accent")
        .trim() || "#f48120";

    const mapSettings = data.map.settings;

    if (!mapSettings) {
      return;
    }

    let map;
    let resizeObserver;

    try {
      setMapError("");

      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: createMapStyle(mapSettings),
        center: [
          Number(
            mapSettings.defaultLongitude ??
              10.4515,
          ),
          Number(
            mapSettings.defaultLatitude ??
              51.1657,
          ),
        ],
        zoom: Number(
          mapSettings.defaultZoom ?? 5,
        ),
        attributionControl: true,
      });

      map.addControl(
        new maplibregl.NavigationControl(),
        "top-right",
      );

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          map.resize();
        });
        resizeObserver.observe(
          mapContainerRef.current,
        );
      }

      requestAnimationFrame(() => {
        map.resize();
      });
    } catch (initializationError) {
      const message =
        initializationError instanceof Error
          ? initializationError.message
          : String(initializationError);

      console.error(
        "MapLibre konnte nicht initialisiert werden:",
        initializationError,
      );
      setMapError(t("dashboard.mapInitFailed", { message }));
      return;
    }

    map.on("error", (event) => {
      const message = event?.error?.message || t("dashboard.mapLoadFailed");
      setMapError(message);
      console.error("MapLibre:", event?.error || event);
    });

    map.on("load", () => {
      map.resize();
      map.addSource("trip-routes", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "trip-routes",
        type: "line",
        source: "trip-routes",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": accent,
          "line-width": 4,
          "line-opacity": 0.72,
        },
      });

      map.addSource("trip-gps-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "trip-gps-points", type: "circle", source: "trip-gps-points",
        paint: { "circle-radius": 3, "circle-color": accent, "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" },
      });

      map.addSource("split-candidates", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "split-candidates",
        type: "circle",
        source: "split-candidates",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": accent,
          "circle-opacity": 0.95,
        },
      });

      map.addSource("split-highlight", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "split-highlight",
        type: "circle",
        source: "split-highlight",
        paint: {
          "circle-radius": 10,
          "circle-color": accent,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addSource("trip-endpoints", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addSource("route-draft", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-draft",
        type: "line",
        source: "route-draft",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": accent, "line-width": 6, "line-dasharray": [2, 2] },
      });

      map.addLayer({
        id: "trip-endpoints",
        type: "circle",
        source: "trip-endpoints",
        paint: {
          "circle-radius": 5,
          "circle-color": accent,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addSource("home-location", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "home-location",
        type: "circle",
        source: "home-location",
        paint: {
          "circle-radius": 8,
          "circle-color": "#ffffff",
          "circle-stroke-width": 4,
          "circle-stroke-color": accent,
        },
      });


      map.addSource("work-location", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "work-location",
        type: "circle",
        source: "work-location",
        paint: {
          "circle-radius": 8,
          "circle-color": accent,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", async (event) => {
        const activeTripId = selectedTripIdRef.current;
        const activeMode = mapModeRef.current;
        if (!activeTripId) return;
        if (activeMode === "split") {
          try {
            let points = splitPointsRef.current;
            if (!points.length) {
              const loadedPoints = await getTripPoints(accessTokenRef.current, activeTripId);
              points = loadedPoints.slice(1, -1);
              splitPointsRef.current = points;
              setTripAction((state) => ({ ...state, splitPoints: points, error: "" }));
            }
            if (!points.length) return;
            let nearest = null;
            let best = Infinity;
            for (const point of points) {
              const coordinates = pointCoordinates(point);
              if (!coordinates) continue;
              const projected = map.project(coordinates);
              const distance = Math.hypot(projected.x - event.point.x, projected.y - event.point.y);
              if (distance < best) { best = distance; nearest = point; }
            }
            if (nearest && best <= 40) {
              setSelectedSplitPointId(nearest.id);
              setHoveredSplitPointId(null);
            }
          } catch (error) {
            setTripAction((state) => ({ ...state, error: error.message }));
          }
        } else if (activeMode === "correct") {
          setRouteDraft((current) => [...current, { longitude: event.lngLat.lng, latitude: event.lngLat.lat }]);
        }
      });
      mapLoadedRef.current = true;
      // Über Refs die aktuelle Version aufrufen: „load“ kann deutlich nach dem
      // Anlegen der Karte feuern (langsamer Tile-Server). Die beim Anlegen
      // gebundenen Funktionen würden sonst eine inzwischen gewählte Fahrt
      // mit veralteten Daten überzeichnen.
      updateMapDataRef.current?.();
      fitAllTripsRef.current?.();
    });

    mapRef.current = map;


  return () => {
      resizeObserver?.disconnect();
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [
    data.map.settings?.provider,
    data.map.settings?.protomapsTileServerUrl,
    data.map.settings?.protomapsAssetsUrl,
    data.map.settings?.protomapsFlavor,
  ]);

  const updateMapDataRef = useRef(updateMapData);
  const fitAllTripsRef = useRef(fitAllTrips);
  updateMapDataRef.current = updateMapData;
  fitAllTripsRef.current = fitAllTrips;

  useEffect(() => {
    updateMapData();
  }, [updateMapData]);

  useEffect(() => {
    if (mapLoadedRef.current) {
      fitAllTrips();
    }
  }, [visibleTrips, data.map.homeLocation, fitAllTrips]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setStatus({
        loading: true,
        error: "",
      });

      try {
        const result = await getDashboard(
          accessToken,
          filters,
        );

        if (!cancelled) {
          setData(result);
          setSelectedTripId((id) => id && result.trips.some((trip) => trip.id === id) ? id : null);
          setStatus({
            loading: false,
            error: "",
          });
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : t("dashboard.tripsLoadFailed"),
          });
        }
      }
    }

    const timeout = setTimeout(
      loadDashboard,
      200,
    );

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [
    accessToken,
    filters.from,
    filters.to,
    filters.type,
    filters.specialCategory,
    filters.tagId,
    reloadKey,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedTripId || detailsTab !== 'history') {
      setHistory({
        loading: false,
        error: "",
        entries: [],
      });
      return () => {
        cancelled = true;
      };
    }

    setHistory({
      loading: true,
      error: "",
      entries: [],
    });

    getTripHistory(accessToken, selectedTripId)
      .then((entries) => {
        if (!cancelled) {
          setHistory({
            loading: false,
            error: "",
            entries: [...entries].reverse(),
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setHistory({
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : t("dashboard.historyLoadFailed"),
            entries: [],
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedTripId, detailsTab]);

  // Deep-Link aus anderen Seiten (z. B. „Fahrt öffnen“ in der Prüfung): /?trip=<id>
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const requestedTripId = searchParams.get("trip");
    if (!requestedTripId || status.loading) return;
    const trip = data.trips.find((item) => String(item.id) === requestedTripId);
    if (trip) selectTrip(trip);
    setSearchParams((params) => { params.delete("trip"); return params; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, status.loading, data.trips]);

  function selectTrip(trip) {
    setSelectedTripId(trip.id);
    setMobilePanel("map");
    setGpsMode("route");
    setGpsPoints([]);
    setGpsError("");
    setDetailsTab('details');
    setEditCategory(trip.type);
    setEditSpecialCategory(trip.specialCategory || "");
    setEditTags((trip.tags || []).map((tag) => tag.id));
    setEditError('');
    setDriverAssignment({ loading: true, drivers: [], selected: "", reason: "" });
    getAssignableTripDrivers(accessToken, trip.id)
      .then((drivers) => setDriverAssignment({ loading: false, drivers, selected: "", reason: "" }))
      .catch(() => setDriverAssignment({ loading: false, drivers: [], selected: "", reason: "" }));
    setMapMode(null);
    setRouteDraft([]);
    getTripSuggestions(accessToken, trip.id)
      .then((result) => setSuggestions(result.suggestions || []))
      .catch(() => setSuggestions([]));

    const coordinates = trip.route.map(
      (point) => [
        point.longitude,
        point.latitude,
      ],
    );

    const map = mapRef.current;

    if (!map || coordinates.length === 0) {
      return;
    }

    if (coordinates.length === 1) {
      map.easeTo({
        center: coordinates[0],
        zoom: 14,
        duration: 500,
      });
      return;
    }

    map.fitBounds(createBounds(coordinates), {
      padding: mapPadding(true, 80),
      maxZoom: 16,
      duration: 500,
    });
  }

  async function performDriverAssignment() {
    if (!selectedTripId) return;
    const targetUserId = driverAssignment.selected || (driverAssignment.drivers.every((driver) => driver.returnOnly) ? driverAssignment.drivers[0]?.userId : "");
    if (!targetUserId) return;
    setTripAction((state) => ({ ...state, busy: true, error: "" }));
    try {
      await assignTripDriver(accessToken, selectedTripId, targetUserId, driverAssignment.reason);
      setSelectedTripId(null);
      setDriverAssignment({ loading: false, drivers: [], selected: "", reason: "" });
      setData(await getDashboard(accessToken, filters));
      setTripAction({ busy: false, error: "", splitPoints: null });
    } catch (error) {
      setTripAction((state) => ({ ...state, busy: false, error: error.message }));
    }
  }

  async function beginSplit() {
    if (!selectedTripId) return;
    setTripAction({ busy: true, error: "", splitPoints: null });
    try {
      const points = await getTripPoints(accessToken, selectedTripId);
      if (points.length < 3) throw new Error(t("dashboard.split.tooFewPoints"));
      const splitPoints = points.slice(1, -1);
      splitPointsRef.current = splitPoints;
      setHoveredSplitPointId(null);
      setSelectedSplitPointId(null);
      setRouteDraft([]);
      setMapMode("split");
      setTripAction({ busy: false, error: "", splitPoints });
    } catch (error) {
      setTripAction({ busy: false, error: error.message, splitPoints: null });
    }
  }

  async function performSplit(pointId) {
    setTripAction((state) => ({ ...state, busy: true, error: "" }));
    try {
      await splitTrip(accessToken, selectedTripId, pointId);
      splitPointsRef.current = [];
      setHoveredSplitPointId(null);
      setSelectedSplitPointId(null);
      setMapMode(null);
      setTripAction({ busy: false, error: "", splitPoints: null });
      setSelectedTripId(null);
      const result = await getDashboard(accessToken, filters);
      setData(result);
    } catch (error) {
      setTripAction((state) => ({ ...state, busy: false, error: error.message }));
    }
  }

  async function performMerge() {
    if (selectedForMerge.length < 2) return;

    const selectedTrips = data.trips
      .filter((trip) => selectedForMerge.includes(trip.id))
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

    if (selectedTrips.length !== selectedForMerge.length) {
      setTripAction((state) => ({ ...state, error: t("dashboard.merge.unavailable") }));
      return;
    }
    if (new Set(selectedTrips.map((trip) => trip.vehicle?.id || trip.vehicleId)).size !== 1) {
      setTripAction((state) => ({ ...state, error: t("dashboard.merge.vehicleMismatch") }));
      return;
    }

    const first = selectedTrips[0];
    const last = selectedTrips[selectedTrips.length - 1];
    const confirmed = window.confirm(
      t("dashboard.merge.confirm", { count: selectedTrips.length, from: formatDate(first.startedAt, locale, first.startTimeZone), to: formatDate(last.endedAt || last.startedAt, locale, last.endTimeZone || last.startTimeZone) }),
    );
    if (!confirmed) return;

    setTripAction({ busy: true, error: "", splitPoints: null });
    try {
      const result = await mergeTrips(accessToken, selectedForMerge);
      setSelectedForMerge([]);
      setSelectedTripId(result?.trip?.id || null);
      const dashboard = await getDashboard(accessToken, filters);
      setData(dashboard);
      setTripAction({ busy: false, error: "", splitPoints: null });
    } catch (error) {
      setTripAction({ busy: false, error: error.message, splitPoints: null });
    }
  }

  function toggleMergeTrip(tripId) {
    setSelectedForMerge((current) =>
      current.includes(tripId) ? current.filter((id) => id !== tripId) : [...current, tripId],
    );
  }

  useEffect(() => {
    const source = mapRef.current?.getSource("route-draft");
    source?.setData({
      type: "FeatureCollection",
      features: routeDraft.length >= 2 ? [{
        type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: routeDraft.map((p) => [p.longitude, p.latitude]) },
      }] : [],
    });
  }, [routeDraft]);

  async function saveRouteCorrection() {
    if (!selectedTripId || routeDraft.length < 2) return;
    setTripAction((state) => ({ ...state, busy: true, error: "" }));
    try {
      await correctTripRoute(accessToken, selectedTripId, routeDraft);
      const result = await getDashboard(accessToken, filters);
      setData(result);
      setMapMode(null); setRouteDraft([]);
      setTripAction({ busy: false, error: "", splitPoints: null });
    } catch (error) {
      setTripAction((state) => ({ ...state, busy: false, error: error.message }));
    }
  }

  useEffect(() => {
    if (!selectedTripId || gpsMode === "route") return;
    let cancelled = false;
    setGpsError("");
    getTripPoints(accessToken, selectedTripId)
      .then((points) => { if (!cancelled) setGpsPoints(points); })
      .catch((error) => { if (!cancelled) setGpsError(error.message); });
    return () => { cancelled = true; };
  }, [accessToken, selectedTripId, gpsMode]);

  async function saveTripDetails() {
    if (!selectedTrip || editBusy) return;
    setEditBusy(true);
    setEditError('');
    try {
      if (
        editCategory !== selectedTrip.type ||
        editSpecialCategory !== (selectedTrip.specialCategory || "")
      ) {
        if (editCategory === 'unclassified') throw new Error(t('tripDetails.categoryRequired'));
        await classifyTrip(
          accessToken,
          selectedTrip.id,
          editCategory,
          editSpecialCategory || null,
        );
      }
      const oldTags = (selectedTrip.tags || []).map((tag) => tag.id).sort();
      if (JSON.stringify([...editTags].sort()) !== JSON.stringify(oldTags)) {
        await updateTripTags(accessToken, selectedTrip.id, editTags);
      }
      setReloadKey((value) => value + 1);
    } catch (error) {
      setEditError(error.message);
    } finally {
      setEditBusy(false);
    }
  }

  function resetFilters() {
    setFilters({
      from: "",
      to: "",
      type: "",
      specialCategory: "",
      tagId: "",
    });
  }

  const fmtDate = (value, timeZone) => formatDate(value, locale, timeZone);
  const fmtKm = (meters) => formatDistance(meters, locale);
  const typeColor = (type) => routeColor(type, routeColors);
  const fieldClass = "mt-1 block h-10 w-full rounded-lg border border-fb-border bg-fb-surface px-3 text-sm text-fb-text outline-none focus:border-fb-accent";
  const secondaryButton = "inline-flex min-h-10 items-center justify-center rounded-lg border border-fb-border bg-fb-main px-3 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent disabled:opacity-50";
  const primaryButton = "inline-flex min-h-10 items-center justify-center rounded-lg bg-fb-accent px-4 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary disabled:opacity-50";
  const mobileDetailsClass = mobileDetailsExpanded ? "block" : "hidden";

  function closeDetails() {
    setSelectedTripId(null);
    setMobileDetailsExpanded(false);
    setMapMode(null);
    setRouteDraft([]);
    setTripAction({ busy: false, error: "", splitPoints: null });
  }

  function cancelSplit() {
    setSelectedSplitPointId(null);
    setHoveredSplitPointId(null);
    setMapMode(null);
    setTripAction((state) => ({ ...state, splitPoints: null, error: "" }));
  }

  return (
    <div className="relative h-[calc(100dvh-4.5rem-1px)] min-h-[320px] overflow-hidden">
      <nav aria-label={t("dashboard.mobileViewLabel")} className="absolute inset-x-3 top-3 z-30 flex gap-2 rounded-xl border border-fb-border bg-fb-main/95 p-1 shadow-lg backdrop-blur md:hidden">
        <button type="button" aria-pressed={mobilePanel === "map"} onClick={() => setMobilePanel("map")} className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${mobilePanel === "map" ? "bg-fb-accent text-fb-accent-text" : "text-fb-muted"}`}>{t("dashboard.map")}</button>
        <button type="button" aria-pressed={mobilePanel === "trips"} onClick={() => setMobilePanel("trips")} className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${mobilePanel === "trips" ? "bg-fb-accent text-fb-accent-text" : "text-fb-muted"}`}>{t("dashboard.trips")} ({data.trips.length})</button>
      </nav>

      <section aria-label={t("dashboard.trips")} className={`${mobilePanel === "trips" ? "flex" : "hidden"} absolute inset-x-3 bottom-3 top-[4.5rem] z-20 min-h-0 flex-col overflow-hidden rounded-xl border border-fb-border bg-fb-main/95 shadow-xl backdrop-blur md:bottom-4 md:left-4 md:right-auto md:top-4 md:flex md:w-[410px]`}>
        <header className="max-h-[55%] shrink-0 overflow-y-auto border-b border-fb-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold">{t("dashboard.trips")}</h1>
              <p className="mt-0.5 text-sm text-fb-muted">{t("dashboard.results", { count: data.trips.length })}</p>
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={resetFilters} className="min-h-9 rounded-lg border border-fb-border px-3 text-xs font-semibold text-fb-muted transition hover:border-fb-accent hover:text-fb-accent">
                {t("dashboard.clearFilters")}
              </button>
              <button type="button" aria-pressed={archiveOpen} onClick={() => { setArchiveError(""); setArchiveOpen((value) => !value); }} className="min-h-9 rounded-lg border border-fb-border px-3 text-xs font-semibold text-fb-muted transition hover:border-fb-accent hover:text-fb-accent">
                {archiveOpen ? t("tripArchive.close") : t("tripArchive.open")}
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-xs font-medium text-fb-muted">
              {t("dashboard.filters.from")}
              <input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs font-medium text-fb-muted">
              {t("dashboard.filters.to")}
              <input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs font-medium text-fb-muted">
              {t("dashboard.filters.type")}
              <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))} className={fieldClass}>
                <option value="">{t("dashboard.allTypes")}</option>
                {TRIP_TYPES.map((type) => <option key={type} value={type}>{tripTypeLabel(t, type)}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-fb-muted">
              {t("dashboard.filters.specialCategory")}
              <select value={filters.specialCategory} onChange={(event) => setFilters((current) => ({ ...current, specialCategory: event.target.value }))} className={fieldClass}>
                <option value="">{t("dashboard.specialCategories.all")}</option>
                {SPECIAL_CATEGORIES.map((category) => <option key={category} value={category}>{specialCategoryLabel(t, category)}</option>)}
              </select>
            </label>
            <label className="col-span-2 text-xs font-medium text-fb-muted">
              {t("dashboard.filters.tag")}
              <select value={filters.tagId} onChange={(event) => setFilters((current) => ({ ...current, tagId: event.target.value }))} className={fieldClass}>
                <option value="">{t("dashboard.allTags")}</option>
                {data.filters.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
          </div>

          {selectedTripId && (
            <button type="button" onClick={() => { closeDetails(); fitAllTrips(); }} className={`${secondaryButton} mt-3 hidden w-full md:inline-flex`}>
              {t("dashboard.showAllTrips")}
            </button>
          )}
        </header>

        {selectedForMerge.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-fb-border bg-fb-accent-soft px-4 py-2.5">
            <span className="text-[13px] font-medium text-fb-accent-strong">{t("dashboard.merge.selected", { count: selectedForMerge.length })}</span>
            <button type="button" disabled={selectedForMerge.length < 2 || tripAction.busy} onClick={performMerge} className="min-h-[34px] rounded-lg bg-fb-accent px-3 text-xs font-semibold text-fb-accent-text disabled:opacity-50">
              {t("dashboard.merge.action")}
            </button>
          </div>
        )}

        {status.error && (
          <div role="alert" className="m-4 rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{status.error}</div>
        )}
        {!selectedTripId && tripAction.error && (
          <div role="alert" className="m-4 rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{tripAction.error}</div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {status.loading ? (
            <div className="p-8 text-center text-sm text-fb-muted">{t("dashboard.loadingTrips")}</div>
          ) : data.trips.length === 0 ? (
            <div className="p-8 text-center">
              <div className="font-semibold">{t("dashboard.noTrips")}</div>
              <p className="mt-2 text-sm text-fb-muted">{t("dashboard.noTripsHint")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-fb-border">
              {data.trips.map((trip) => {
                const selected = selectedTripId === trip.id;
                const marked = selectedForMerge.includes(trip.id);
                return (
                  <li key={trip.id} className={`relative ${marked && !selected ? "bg-fb-accent-soft/60" : ""}`}>
                    <label className="absolute left-4 top-4 z-10 flex size-6 cursor-pointer items-center justify-center" title={t("dashboard.merge.selectForMerge")}>
                      <input type="checkbox" checked={marked} onChange={() => toggleMergeTrip(trip.id)} aria-label={t("dashboard.merge.selectForMerge")} className="size-4 accent-[var(--color-accent)]" />
                    </label>
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      onClick={() => selectTrip(trip)}
                      className={`block w-full py-3.5 pl-12 pr-4 text-left transition ${selected ? "bg-fb-accent-soft shadow-[inset_3px_0_0_var(--color-accent)]" : "hover:bg-fb-surface"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: typeColor(trip.type) }} />
                            <span className="text-sm font-semibold">{tripTypeLabel(t, trip.type)}</span>
                            <span className="text-xs text-fb-muted">{trip.vehicle?.name}</span>
                            {trip.specialCategory && (
                              <span className="rounded-full border border-fb-border px-2 py-0.5 text-[11px] text-fb-muted">{specialCategoryLabel(t, trip.specialCategory)}</span>
                            )}
                          </div>
                          <div className="mt-1.5 truncate text-sm">{trip.startAddress || t("dashboard.unknownStart")}</div>
                          <div className="mt-0.5 truncate text-sm text-fb-muted">→ {trip.endAddress || t("dashboard.unknownDestination")}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-bold text-fb-accent">{fmtKm(trip.distanceMeters)}</div>
                          <div className="mt-1 text-xs text-fb-muted">{fmtDate(trip.startedAt, trip.startTimeZone)}</div>
                        </div>
                      </div>
                      {(trip.tags || []).length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {trip.tags.map((tag) => (
                            <span key={tag.id} className="rounded-full border border-fb-border px-2 py-0.5 text-xs text-fb-muted">{tag.name}</span>
                          ))}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Zoom-Steuerung unter den mobilen Umschalter bzw. neben das Detailpanel schieben. */}
      <section className={`absolute inset-0 z-0 overflow-hidden [&_.maplibregl-ctrl-top-right]:mt-[4.5rem] md:[&_.maplibregl-ctrl-top-right]:mt-0 ${selectedTrip ? "md:[&_.maplibregl-ctrl-top-right]:mr-[440px]" : ""}`}>
        <div ref={mapContainerRef} className="h-full w-full" />

        {mapError && (
          <div role="alert" className="absolute left-1/2 top-4 z-20 w-[min(720px,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-fb-danger bg-fb-main/95 px-4 py-3 text-sm text-fb-danger shadow-lg">
            <strong className="block">{t("dashboard.mapErrorTitle")}</strong>
            <span className="mt-1 block break-words">{mapError}</span>
          </div>
        )}

        {!selectedTripId && data.trips.length > 0 && (
          <div className="absolute bottom-4 left-[444px] z-10 hidden flex-wrap gap-3.5 rounded-lg border border-fb-border bg-fb-main/95 px-3.5 py-2.5 text-xs text-fb-text/80 shadow-sm backdrop-blur md:flex">
            {TRIP_TYPES.map((type) => (
              <span key={type} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-1 w-[18px] rounded-sm" style={{ backgroundColor: typeColor(type) }} />
                {tripTypeLabel(t, type)}
              </span>
            ))}
          </div>
        )}

        {archiveOpen && (
          <div role="dialog" aria-modal="false" aria-labelledby="trip-archive-title" className="absolute inset-3 z-30 overflow-auto rounded-xl border border-fb-border bg-fb-main p-4 shadow-xl md:inset-4 md:left-[440px] md:p-6">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="trip-archive-title" className="text-lg font-semibold">{t("tripArchive.title")}</h2>
              <button type="button" onClick={() => setArchiveOpen(false)} className={secondaryButton}>{t("tripArchive.close")}</button>
            </div>
            <p className="mb-4 text-sm text-fb-muted">{t("tripArchive.retention")}</p>
            {archiveError && <p role="alert" className="mb-3 text-sm text-fb-danger">{archiveError}</p>}
            {archivedTrips.length === 0 && <p className="text-sm text-fb-muted">{t("tripArchive.empty")}</p>}
            <div className="grid gap-3 lg:grid-cols-2">
              {archivedTrips.map((trip) => (
                <div key={trip.id} className="rounded-xl border border-fb-border p-4">
                  <div className="font-medium">{fmtDate(trip.startedAt, trip.startTimeZone)}</div>
                  <div className="mt-0.5 text-xs text-fb-muted">{t("tripArchive.purgeAt")}: {fmtDate(trip.purgeAt)}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={archiveBusy} onClick={() => changeTrip(trip.id, "restore")} className={secondaryButton}>{t("tripArchive.restore")}</button>
                    <button type="button" disabled={archiveBusy} onClick={() => changeTrip(trip.id, "delete")} className="inline-flex min-h-10 items-center rounded-lg border border-fb-danger px-3 text-sm font-semibold text-fb-danger disabled:opacity-50">{t("tripArchive.deleteForever")}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedTrip && (
          <section aria-label={t("tripDetails.title")} className={`${mobilePanel === "map" ? "flex" : "hidden"} absolute bottom-3 left-3 right-3 z-20 max-h-[calc(100%-5.5rem)] flex-col overflow-hidden rounded-xl border border-fb-border bg-fb-main/95 shadow-xl backdrop-blur md:bottom-4 md:left-auto md:right-4 md:top-4 md:flex md:max-h-none md:w-[420px]`}>
            {/* Mobil eingeklappt: kompakte Zusammenfassung als Bottom-Sheet. */}
            {!mobileDetailsExpanded && (
              <div className="md:hidden">
                <div className="flex justify-center pt-2"><span aria-hidden="true" className="h-1 w-10 rounded-full bg-fb-border" /></div>
                <div className="space-y-3 px-4 pb-4 pt-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: typeColor(selectedTrip.type) }} />
                        <span className="font-bold">{tripTypeLabel(t, selectedTrip.type)}</span>
                        <span className="truncate text-xs text-fb-muted">{selectedTrip.vehicle?.name}</span>
                      </div>
                      <div className="mt-1.5 truncate text-[13px]">{selectedTrip.startAddress || t("dashboard.unknownStart")}</div>
                      <div className="truncate text-[13px] text-fb-muted">→ {selectedTrip.endAddress || t("dashboard.unknownDestination")}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-bold text-fb-accent-strong">{fmtKm(selectedTrip.distanceMeters)}</div>
                      <div className="mt-0.5 text-xs text-fb-muted">{fmtDate(selectedTrip.startedAt, selectedTrip.startTimeZone)}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setMobileDetailsExpanded(true)} className="h-11 flex-1 rounded-lg bg-fb-accent text-sm font-semibold text-fb-accent-text">{t("dashboard.openDetails")}</button>
                    <button type="button" onClick={closeDetails} aria-label={t("common.close")} className="flex size-11 items-center justify-center rounded-lg border border-fb-border text-fb-muted">
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
            <header className={`${mobileDetailsExpanded ? "block" : "hidden"} shrink-0 border-b border-fb-border px-4 pt-3.5 md:block`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-fb-muted">{t("tripDetails.title")}</div>
                  <div className="truncate text-base font-bold">{routeTitle(selectedTrip, t)}</div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => setMobileDetailsExpanded(false)} className="min-h-10 rounded-lg border border-fb-border px-3 text-xs font-semibold md:hidden">
                    {t("dashboard.collapseDetails")}
                  </button>
                  <button type="button" onClick={closeDetails} aria-label={t("common.close")} className="flex size-10 items-center justify-center rounded-lg border border-fb-border text-fb-muted transition hover:border-fb-accent hover:text-fb-accent">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              </div>
              <div role="tablist" className="mt-2.5 flex gap-5">
                {["details", "history"].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={detailsTab === tab}
                    onClick={() => setDetailsTab(tab)}
                    className={`h-10 border-b-2 text-sm ${detailsTab === tab ? "border-fb-accent font-semibold text-fb-accent-strong" : "border-transparent font-medium text-fb-muted hover:text-fb-text"}`}
                  >
                    {t(`tripDetails.${tab}`)}
                  </button>
                ))}
              </div>
            </header>

            {detailsTab === "details" && (
              <div className={`${mobileDetailsClass} min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 text-sm md:block`}>
                <dl className="grid grid-cols-2 gap-3">
                  <div><dt className="text-xs text-fb-muted">{t("tripDetails.start")}</dt><dd className="mt-0.5 font-medium">{fmtDate(selectedTrip.startedAt, selectedTrip.startTimeZone)}</dd></div>
                  <div><dt className="text-xs text-fb-muted">{t("tripDetails.end")}</dt><dd className="mt-0.5 font-medium">{selectedTrip.endedAt ? fmtDate(selectedTrip.endedAt, selectedTrip.endTimeZone) : "–"}</dd></div>
                  <div><dt className="text-xs text-fb-muted">{t("tripDetails.from")}</dt><dd className="mt-0.5 font-medium">{selectedTrip.startAddress || "–"}</dd></div>
                  <div><dt className="text-xs text-fb-muted">{t("tripDetails.to")}</dt><dd className="mt-0.5 font-medium">{selectedTrip.endAddress || "–"}</dd></div>
                  <div><dt className="text-xs text-fb-muted">{t("tripDetails.distance")}</dt><dd className="mt-0.5 font-bold text-fb-accent">{fmtKm(selectedTrip.distanceMeters)}</dd></div>
                  <div><dt className="text-xs text-fb-muted">{t("tripDetails.vehicle")}</dt><dd className="mt-0.5 font-medium">{selectedTrip.vehicle?.name || "–"}</dd></div>
                </dl>

                <div>
                  <div className="mb-2 font-semibold">{t("tripGpsView.label")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(data.mapMatchingVisible !== false && selectedTrip.mapMatching?.status === "applied"
                      ? ["route", "original", "both", "points"]
                      : ["route", "both", "points"]).map((mode) => (
                      <button
                        type="button"
                        key={mode}
                        onClick={() => setGpsMode(mode)}
                        aria-pressed={gpsMode === mode}
                        className={`min-h-9 rounded-lg border px-3 text-xs ${gpsMode === mode ? "border-fb-accent bg-fb-accent-soft font-semibold text-fb-accent" : "border-fb-border hover:border-fb-accent"}`}
                      >
                        {t(`tripGpsView.${mode}`)}
                      </button>
                    ))}
                  </div>
                  {gpsError && <p role="alert" className="mt-2 text-xs text-fb-danger">{gpsError}</p>}
                  {(gpsMode === "both" || gpsMode === "points") && <p className="mt-2 text-xs text-fb-muted">{gpsPoints.length} {t("tripGpsView.pointsCount")}</p>}
                  {data.mapMatchingVisible !== false && selectedTrip.mapMatching?.status === "applied" && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-fb-accent-strong">
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-px h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19 9 5M20 19 15 5M12 6v2M12 11v2M12 16v2" /></svg>
                      <span>
                        {t("tripGpsView.matched")
                          .replace("{provider}", { atlas: "Dawarich Atlas", valhalla: "Valhalla", osrm: "OSRM" }[selectedTrip.mapMatching.provider] || selectedTrip.mapMatching.provider)
                          .replace("{km}", fmtKm(selectedTrip.mapMatching.rawDistanceMeters))}
                        {gpsMode === "route" && <span className="block text-fb-muted">{t("tripGpsView.matchedHint")}</span>}
                      </span>
                    </p>
                  )}
                  {data.mapMatchingVisible !== false && ["rejected", "failed"].includes(selectedTrip.mapMatching?.status) && (
                    <p className="mt-2 text-xs text-fb-muted">
                      {t(`tripGpsView.${selectedTrip.mapMatching.status}`).replace("{message}", selectedTrip.mapMatching.message || "–")}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="font-semibold">
                    {t("tripDetails.category")}
                    <select value={editCategory} onChange={(event) => setEditCategory(event.target.value)} className={`${fieldClass} font-normal`}>
                      {["unclassified", "private", "business", "commute"].map((type) => <option key={type} value={type}>{tripTypeLabel(t, type)}</option>)}
                    </select>
                  </label>
                  <label className="font-semibold">
                    {t("tripDetails.specialCategory")}
                    <select value={editSpecialCategory} onChange={(event) => setEditSpecialCategory(event.target.value)} className={`${fieldClass} font-normal`}>
                      <option value="">{t("dashboard.specialCategories.none")}</option>
                      {SPECIAL_CATEGORIES.map((category) => <option key={category} value={category}>{specialCategoryLabel(t, category)}</option>)}
                    </select>
                  </label>
                  <p className="col-span-2 -mt-1 text-xs text-fb-muted">{t("tripDetails.specialCategoryHint")}</p>
                </div>

                <fieldset>
                  <legend className="mb-2 font-semibold">{t("tripDetails.tags")}</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {data.filters.tags.map((tag) => {
                      const checked = editTags.includes(tag.id);
                      return (
                        <label key={tag.id} className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 ${checked ? "border-fb-accent bg-fb-accent-soft text-fb-accent" : "border-fb-border hover:border-fb-accent"}`}>
                          <input type="checkbox" checked={checked} onChange={(event) => setEditTags((previous) => event.target.checked ? [...previous, tag.id] : previous.filter((id) => id !== tag.id))} className="accent-[var(--color-accent)]" />
                          {tag.name}
                        </label>
                      );
                    })}
                    {data.filters.tags.length === 0 && <span className="text-fb-muted">{t("tripDetails.noTags")}</span>}
                  </div>
                </fieldset>

                {suggestions.slice(0, 3).map((suggestion, index) => (
                  <div key={index} className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-fb-accent-soft">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 size-[18px] shrink-0 text-fb-accent-strong" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8 9.5 8z" /></svg>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-fb-accent-strong">{t("dashboard.suggestionTitle")}: {tripTypeLabel(t, suggestion.type)}</div>
                      <div className="mt-0.5 text-fb-muted">{suggestion.reason}</div>
                    </div>
                    {editCategory !== suggestion.type && (
                      <button type="button" onClick={() => setEditCategory(suggestion.type)} className="shrink-0 text-xs font-semibold text-fb-accent-strong hover:underline">
                        {t("dashboard.applySuggestion")}
                      </button>
                    )}
                  </div>
                ))}

                {editError && <p role="alert" className="text-fb-danger">{editError}</p>}
                <button type="button" disabled={editBusy} onClick={saveTripDetails} className={`${primaryButton} w-full`}>
                  {editBusy ? t("common.saving") : t("tripDetails.save")}
                </button>

                {selectedTrip.reconciliationMetadata?.splitRecommended && (
                  <div className="rounded-xl border border-fb-accent bg-fb-accent-soft p-3">
                    <div className="font-semibold">{t("dashboard.reconciliation.title")}</div>
                    <div className="mt-1 text-xs text-fb-muted">{t("dashboard.reconciliation.hint")}</div>
                    <button type="button" disabled={tripAction.busy} onClick={beginSplit} className="mt-2 min-h-9 rounded-lg bg-fb-accent px-3 text-xs font-semibold text-fb-accent-text disabled:opacity-50">{t("dashboard.reconciliation.review")}</button>
                  </div>
                )}

                <section aria-labelledby="trip-edit-title" className="space-y-3 border-t border-fb-border pt-4">
                  <h3 id="trip-edit-title" className="font-semibold">{t("dashboard.editSection")}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={tripAction.busy} aria-pressed={mapMode === "split"} onClick={beginSplit} className={secondaryButton}>
                      {t("dashboard.split.action")}
                    </button>
                    <button type="button" disabled={tripAction.busy} aria-pressed={mapMode === "correct"} onClick={() => { cancelSplit(); setMapMode("correct"); setRouteDraft([]); }} className={secondaryButton}>
                      {t("dashboard.routeCorrection.action")}
                    </button>
                  </div>

                  {mapMode === "split" && <p className="text-xs text-fb-muted">{t("dashboard.split.hint")}</p>}
                  {tripAction.splitPoints && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-fb-border bg-fb-surface p-2">
                      <div className="mb-2 text-xs text-fb-muted">{t("dashboard.split.selectPoint")}</div>
                      {tripAction.splitPoints.map((point) => {
                        const isSelected = String(selectedSplitPointId) === String(point.id);
                        const isHovered = String(hoveredSplitPointId) === String(point.id);
                        return (
                          <button
                            key={point.id}
                            type="button"
                            onClick={() => setSelectedSplitPointId(point.id)}
                            onMouseEnter={() => setHoveredSplitPointId(point.id)}
                            onMouseLeave={() => setHoveredSplitPointId(null)}
                            onFocus={() => setHoveredSplitPointId(point.id)}
                            onBlur={() => setHoveredSplitPointId(null)}
                            aria-pressed={isSelected}
                            className={`block w-full rounded px-2 py-1.5 text-left text-xs ${isSelected ? "bg-fb-accent text-fb-accent-text" : isHovered ? "bg-fb-accent-soft text-fb-accent" : "hover:bg-fb-accent-soft"}`}
                          >
                            {fmtDate(point.recordedAt, selectedTrip.startTimeZone)}
                          </button>
                        );
                      })}
                      <div className="sticky bottom-0 mt-2 flex gap-2 border-t border-fb-border bg-fb-surface pt-2">
                        <button type="button" disabled={!selectedSplitPointId || tripAction.busy} onClick={() => performSplit(selectedSplitPointId)} className="min-h-9 flex-1 rounded-lg bg-fb-accent px-3 text-xs font-semibold text-fb-accent-text disabled:opacity-50">
                          {t("dashboard.split.confirmPoint")}
                        </button>
                        <button type="button" disabled={tripAction.busy} onClick={cancelSplit} className="min-h-9 rounded-lg border border-fb-border px-3 text-xs font-semibold">
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  )}

                  {mapMode === "correct" && (
                    <div className="rounded-lg border border-fb-border bg-fb-surface p-3">
                      <p className="text-xs text-fb-muted">{t("dashboard.routeCorrection.hint")}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" disabled={routeDraft.length === 0} onClick={() => setRouteDraft((points) => points.slice(0, -1))} className="min-h-9 rounded-lg border border-fb-border bg-fb-main px-3 text-xs disabled:opacity-50">{t("dashboard.routeCorrection.removeLast")}</button>
                        <button type="button" disabled={routeDraft.length < 2 || tripAction.busy} onClick={saveRouteCorrection} className="min-h-9 rounded-lg bg-fb-accent px-3 text-xs font-semibold text-fb-accent-text disabled:opacity-50">{t("dashboard.routeCorrection.save")}</button>
                        <button type="button" onClick={() => { setMapMode(null); setRouteDraft([]); }} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-fb-muted hover:text-fb-accent">{t("common.cancel")}</button>
                      </div>
                    </div>
                  )}

                  {tripAction.error && <p role="alert" className="text-xs text-fb-danger">{tripAction.error}</p>}

                  {driverAssignment.drivers.length > 0 && (() => {
                    const returnOnly = driverAssignment.drivers.every((driver) => driver.returnOnly);
                    if (!returnOnly) {
                      return (
                        <label className="block font-semibold">
                          {t("dashboard.driver.assignTitle")}
                          <span className="mt-1 flex gap-2">
                            <select value={driverAssignment.selected} onChange={(event) => setDriverAssignment((state) => ({ ...state, selected: event.target.value }))} className="h-10 min-w-0 flex-1 rounded-lg border border-fb-border bg-fb-surface px-2 text-sm font-normal">
                              <option value="">{t("dashboard.driver.selectUser")}</option>
                              {driverAssignment.drivers.map((driver) => <option key={driver.userId} value={driver.userId}>{driver.displayName || driver.username}{driver.isOwner ? ` (${t("dashboard.driver.owner")})` : ""}</option>)}
                            </select>
                            <button type="button" disabled={!driverAssignment.selected || tripAction.busy} onClick={performDriverAssignment} className={secondaryButton}>{t("dashboard.driver.assignAction")}</button>
                          </span>
                        </label>
                      );
                    }
                    return (
                      <div className="rounded-lg border border-fb-border bg-fb-surface p-3">
                        <div className="text-xs font-semibold">{returnOnly ? t("dashboard.driver.returnTitle") : t("dashboard.driver.assignTitle")}</div>
                        {returnOnly ? (
                          <>
                            <div className="mt-1 text-xs text-fb-muted">{t("dashboard.driver.returnHint")}</div>
                            <button type="button" onClick={() => setDriverAssignment((state) => ({ ...state, selected: state.drivers[0]?.userId || "", reason: t("dashboard.driver.notDriverReason") }))} className="mt-2 min-h-9 rounded-lg border border-fb-border bg-fb-main px-3 text-xs font-semibold hover:border-fb-accent">{t("dashboard.driver.notDriver")}</button>
                            <textarea value={driverAssignment.reason} onChange={(event) => setDriverAssignment((state) => ({ ...state, reason: event.target.value, selected: state.selected || state.drivers[0]?.userId || "" }))} placeholder={t("dashboard.driver.reasonPlaceholder")} aria-label={t("dashboard.driver.reasonPlaceholder")} maxLength={500} className="mt-2 min-h-16 w-full rounded-lg border border-fb-border bg-fb-main px-2 py-1.5 text-sm" />
                            <button type="button" disabled={!driverAssignment.reason.trim() || tripAction.busy} onClick={performDriverAssignment} className="mt-2 min-h-9 rounded-lg bg-fb-accent px-3 text-xs font-semibold text-fb-accent-text disabled:opacity-50">{t("dashboard.driver.returnAction")}</button>
                          </>
                        ) : null}
                      </div>
                    );
                  })()}
                </section>

                <div className="border-t border-fb-border pt-4">
                  <button type="button" disabled={archiveBusy} onClick={() => changeTrip(selectedTrip.id, "archive")} className="inline-flex min-h-10 items-center rounded-lg border border-fb-danger/50 px-3 text-sm font-semibold text-fb-danger transition hover:border-fb-danger disabled:opacity-50">
                    {t("tripArchive.moveToArchive")}
                  </button>
                  {archiveError && <p role="alert" className="mt-2 text-fb-danger">{archiveError}</p>}
                </div>
              </div>
            )}

            {detailsTab === "history" && (
              <div className={`${mobileDetailsClass} min-h-0 flex-1 overflow-y-auto p-4 md:block`}>
                {history.loading ? (
                  <div className="py-3 text-sm text-fb-muted">{t("dashboard.loadingHistory")}</div>
                ) : history.error ? (
                  <div role="alert" className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">{history.error}</div>
                ) : history.entries.length === 0 ? (
                  <div className="py-3 text-sm text-fb-muted">{t("dashboard.noHistory")}</div>
                ) : (
                  <ol className="space-y-2">
                    {history.entries.map((entry) => {
                      const summary = historySummary(entry, t);
                      const actor = entry.actor?.displayName || entry.actor?.username || entry.actor?.email || t("dashboard.systemActor");
                      return (
                        <li key={entry.id} className="rounded-lg border border-fb-border bg-fb-surface px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm font-medium">{historyEventLabel(t, entry.eventType)}</div>
                            <time dateTime={entry.createdAt} className="shrink-0 text-[11px] text-fb-muted">{fmtDate(entry.createdAt)}</time>
                          </div>
                          {summary && <div className="mt-1 text-xs text-fb-muted">{summary}</div>}
                          <div className="mt-1 text-[11px] text-fb-muted">{actor}</div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}
          </section>
        )}

        {!status.loading && data.trips.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 hidden justify-center px-4 md:flex">
            <div className="rounded-lg border border-fb-border bg-fb-main/95 px-4 py-3 text-center text-sm shadow-lg backdrop-blur">
              {data.map.homeLocation ? (
                <>
                  <div className="font-semibold">{t("dashboard.home.title")}</div>
                  <div className="mt-1 text-fb-muted">{data.map.homeLocation.address}</div>
                </>
              ) : (
                <>
                  <div className="font-semibold">{t("dashboard.home.missing")}</div>
                  <div className="mt-1 text-fb-muted">{t("dashboard.home.missingHint")}</div>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
