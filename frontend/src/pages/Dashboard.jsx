
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
import { useI18n } from "../i18n/I18nProvider.jsx";

const OSM_MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "/api/v1/map/osm/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap-Mitwirkende",
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
          "Protomaps © OpenStreetMap-Mitwirkende",
      },
    },
    layers: layers(
      "protomaps",
      namedFlavor(flavorName),
      { lang: "de" },
    ),
  };
}


const tripTypeLabels = {
  business: "Dienstlich",
  private: "Privat",
  commute: "Arbeitsweg",
  unclassified: "Nicht zugeordnet",
};

const historyEventLabels = {
  CREATED: "Fahrt angelegt",
  UPDATED: "Fahrt geändert",
  CLASSIFIED: "Fahrttyp geändert",
  ARCHIVED: "Fahrt archiviert",
  DELETED: "Fahrt gelöscht",
  TAG_ADDED: "Tag hinzugefügt",
  TAG_REMOVED: "Tag entfernt",
  MAP_MATCHED: "Strecke auf Straßennetz abgeglichen",
  TRIP_SPLIT: "Fahrt geteilt",
  TRIP_MERGED: "Fahrten zusammengeführt",
  TRACK_DUPLICATE: "Doppelte Geräteaufzeichnung erkannt",
  TRACK_RECONCILED: "Geräteaufzeichnungen zusammengeführt",
  DRIVER_ASSIGNED: "Fahrer geändert",
  ROUTE_CORRECTED: "Route manuell korrigiert",
  AUTO_CLASSIFIED: "Automatisch klassifiziert",
  BASELINE: "Historie aktiviert",
};

const historyFieldLabels = {
  vehicle_id: "Fahrzeug",
  type: "Fahrttyp",
  status: "Status",
  started_at: "Startzeit",
  ended_at: "Endzeit",
  start_address: "Startadresse",
  end_address: "Zieladresse",
  purpose: "Zweck",
  contact: "Kontakt",
  notes: "Notizen",
  distance_meters: "Strecke",
  duration_seconds: "Dauer",
  archived_at: "Archivierung",
  tags: "Tags",
};

function historySummary(entry) {
  const fields = Object.keys(entry.changedFields || {})
    .filter((field) => !["updated_at", "version"].includes(field))
    .map((field) => historyFieldLabels[field] || field);

  if (fields.length === 0) {
    return "";
  }

  return fields.slice(0, 4).join(", ") +
    (fields.length > 4 ? ` +${fields.length - 4}` : "");
}

function formatDistance(meters) {
  return `${(
    Number(meters || 0) / 1000
  ).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} km`;
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toLineFeatures(trips) {
  return trips
    .filter((trip) => trip.route.length >= 2)
    .map((trip) => ({
      type: "Feature",
      id: trip.id,
      properties: {
        tripId: trip.id,
        type: trip.type,
        label: tripTypeLabels[trip.type] || trip.type,
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

  const [filters, setFilters] = useState({
    from: "",
    to: "",
    type: "",
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
  const [selectedForMerge, setSelectedForMerge] = useState([]);
  const [tripAction, setTripAction] = useState({ busy: false, error: "", splitPoints: null });
  const [suggestions, setSuggestions] = useState([]);
  const [mapMode, setMapMode] = useState(null);
  const [routeDraft, setRouteDraft] = useState([]);
  const [driverAssignment, setDriverAssignment] = useState({ loading: false, drivers: [], selected: "", reason: "" });

  const [selectedTripId, setSelectedTripId] =
    useState(null);

  const [detailsTab, setDetailsTab] = useState("details");
  const [editCategory, setEditCategory] = useState("unclassified");
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

  const lineFeatures = useMemo(
    () => toLineFeatures(visibleTrips),
    [visibleTrips],
  );

  const endpointFeatures = useMemo(
    () => toEndpointFeatures(visibleTrips),
    [visibleTrips],
  );

  const fitAllTrips = useCallback(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const coordinates = collectCoordinates(
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
        padding: 70,
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
    selectedTripId,
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
      setMapError(
        `MapLibre konnte nicht gestartet werden: ${message}`,
      );
      return;
    }

    map.on("error", (event) => {
      const message = event?.error?.message || "Die Karte konnte nicht geladen werden.";
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
            const points = await getTripPoints(accessToken, activeTripId);
            if (points.length < 3) return;
            let nearest = points[1], best = Infinity;
            for (const point of points.slice(1, -1)) {
              const p = map.project([point.longitude, point.latitude]);
              const d = Math.hypot(p.x - event.point.x, p.y - event.point.y);
              if (d < best) { best = d; nearest = point; }
            }
            if (best <= 40) await splitTrip(accessToken, activeTripId, nearest.id).then(async () => {
              setSelectedTripId(null); setMapMode(null);
              setData(await getDashboard(accessToken, filters));
            });
          } catch (error) {
            setTripAction((state) => ({ ...state, error: error.message }));
          }
        } else if (activeMode === "correct") {
          setRouteDraft((current) => [...current, { longitude: event.lngLat.lng, latitude: event.lngLat.lat }]);
        }
      });
      mapLoadedRef.current = true;
      updateMapData();
      fitAllTrips();
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
                : "Die Fahrten konnten nicht geladen werden.",
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
                : "Die Historie konnte nicht geladen werden.",
            entries: [],
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedTripId, detailsTab]);

  function selectTrip(trip) {
    setSelectedTripId(trip.id);
    setDetailsTab('details');
    setEditCategory(trip.type);
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
      padding: 80,
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
      if (points.length < 3) throw new Error("Die Fahrt hat zu wenige GPS-Punkte zum Teilen.");
      setTripAction({ busy: false, error: "", splitPoints: points.slice(1, -1) });
    } catch (error) {
      setTripAction({ busy: false, error: error.message, splitPoints: null });
    }
  }

  async function performSplit(pointId) {
    setTripAction((state) => ({ ...state, busy: true, error: "" }));
    try {
      await splitTrip(accessToken, selectedTripId, pointId);
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
    setTripAction({ busy: true, error: "", splitPoints: null });
    try {
      await mergeTrips(accessToken, selectedForMerge);
      setSelectedForMerge([]);
      setSelectedTripId(null);
      const result = await getDashboard(accessToken, filters);
      setData(result);
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

  async function saveTripDetails() {
    if (!selectedTrip || editBusy) return;
    setEditBusy(true);
    setEditError('');
    try {
      if (editCategory !== selectedTrip.type) {
        if (editCategory === 'unclassified') throw new Error(t('tripDetails.categoryRequired'));
        await classifyTrip(accessToken, selectedTrip.id, editCategory, selectedTrip.purpose, selectedTrip.contact);
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
      tagId: "",
    });
  }

  return (
    <div className="relative h-[calc(100vh-4.5rem)] min-h-[520px] overflow-hidden">
      <section className="absolute bottom-4 left-4 top-4 z-20 flex w-[min(410px,calc(100%-2rem))] min-h-0 flex-col overflow-hidden rounded-xl border border-fb-border bg-fb-main/95 shadow-xl backdrop-blur md:w-[410px]">
        <header className="border-b border-fb-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">
                Fahrten
              </h1>

              <p className="mt-1 text-sm text-fb-muted">
                {data.trips.length} Treffer
              </p>
            </div>

            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg border border-fb-border px-3 py-2 text-xs font-semibold text-fb-muted transition hover:border-fb-accent hover:text-fb-accent"
            >
              Filter löschen
            </button>
            <button type="button" onClick={() => { setArchiveError(""); setArchiveOpen((v) => !v); }} className="rounded-lg border border-fb-border px-3 py-2 text-xs font-semibold">{archiveOpen ? t("tripArchive.close") : t("tripArchive.open")}</button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <label className="text-xs font-medium text-fb-muted">
              Von
              <input
                type="date"
                value={filters.from}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
                className="mt-1 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2 text-sm text-fb-text outline-none focus:border-fb-accent"
              />
            </label>

            <label className="text-xs font-medium text-fb-muted">
              Bis
              <input
                type="date"
                value={filters.to}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
                className="mt-1 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2 text-sm text-fb-text outline-none focus:border-fb-accent"
              />
            </label>

            <label className="text-xs font-medium text-fb-muted">
              Typ
              <select
                value={filters.type}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    type: event.target.value,
                  }))
                }
                className="mt-1 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2 text-sm text-fb-text outline-none focus:border-fb-accent"
              >
                <option value="">
                  Alle Typen
                </option>
                <option value="business">
                  Dienstlich
                </option>
                <option value="private">
                  Privat
                </option>
                <option value="commute">
                  Arbeitsweg
                </option>
                <option value="unclassified">
                  Nicht zugeordnet
                </option>
              </select>
            </label>

            <label className="text-xs font-medium text-fb-muted">
              Tag
              <select
                value={filters.tagId}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    tagId: event.target.value,
                  }))
                }
                className="mt-1 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2 text-sm text-fb-text outline-none focus:border-fb-accent"
              >
                <option value="">
                  Alle Tags
                </option>

                {data.filters.tags.map((tag) => (
                  <option
                    key={tag.id}
                    value={tag.id}
                  >
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="border-b border-fb-border p-3">
          <button
            type="button"
            onClick={() => {
              setSelectedTripId(null);
              fitAllTrips();
            }}
            className="w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent"
          >
            Alle Fahrten anzeigen
          </button>
        </div>

        {selectedForMerge.length > 0 && (
          <div className="border-b border-fb-border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-fb-muted">{selectedForMerge.length} Fahrt(en) gewählt</span>
              <button
                type="button"
                disabled={selectedForMerge.length < 2 || tripAction.busy}
                onClick={performMerge}
                className="rounded-lg bg-fb-accent px-3 py-2 text-xs font-semibold text-fb-accent-text disabled:opacity-50"
              >
                Zusammenführen
              </button>
            </div>
          </div>
        )}

        {status.error && (
          <div className="m-4 rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">
            {status.error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {status.loading ? (
            <div className="p-8 text-center text-sm text-fb-muted">
              Fahrten werden geladen …
            </div>
          ) : data.trips.length === 0 ? (
            <div className="p-8 text-center">
              <div className="font-semibold">
                Keine Fahrten gefunden
              </div>

              <p className="mt-2 text-sm text-fb-muted">
                Passe die Filter an oder erfasse
                deine erste Fahrt.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-fb-border">
              {data.trips.map((trip) => (
                <div
                  key={trip.id}
                  className={[
                    "relative transition", selectedForMerge.includes(trip.id) ? "bg-fb-accent-soft" : "",
                  ].join(" ")}
                >
                  <label className="absolute left-3 top-4 z-10 flex cursor-pointer items-center" title="Für Zusammenführen auswählen">
                    <input
                      type="checkbox"
                      checked={selectedForMerge.includes(trip.id)}
                      onChange={() => toggleMergeTrip(trip.id)}
                      className="size-4 accent-current"
                    />
                  </label>
                <button
                  type="button"
                  onClick={() => selectTrip(trip)}
                  className={[
                    "block w-full py-4 pl-10 pr-4 text-left transition",
                    selectedTripId === trip.id
                      ? "bg-fb-accent-soft"
                      : "hover:bg-fb-surface",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                          {tripTypeLabels[
                            trip.type
                          ] || trip.type}
                        </span>

                        <span className="text-xs text-fb-muted">
                          {trip.vehicle.name}
                        </span>
                      </div>

                      <div className="mt-2 truncate text-sm">
                        {trip.startAddress ||
                          "Unbekannter Start"}
                      </div>

                      <div className="mt-1 truncate text-sm text-fb-muted">
                        →{" "}
                        {trip.endAddress ||
                          "Unbekanntes Ziel"}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="font-bold text-fb-accent">
                        {formatDistance(
                          trip.distanceMeters,
                        )}
                      </div>

                      <div className="mt-1 text-xs text-fb-muted">
                        {formatDate(
                          trip.startedAt,
                        )}
                      </div>
                    </div>
                  </div>

                  {trip.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {trip.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full border border-fb-border px-2 py-0.5 text-xs text-fb-muted"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="absolute inset-0 z-0 overflow-hidden">
        <div
          ref={mapContainerRef}
          className="h-full w-full"
        />

        {mapError && (
          <div className="absolute left-1/2 top-4 z-20 w-[min(720px,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-red-500/50 bg-fb-main/95 px-4 py-3 text-sm text-red-400 shadow-lg">
            <strong className="block">MapLibre-Kartenfehler</strong>
            <span className="mt-1 block break-words">{mapError}</span>
          </div>
        )}

        {archiveOpen && (
          <div className="absolute inset-4 z-30 overflow-auto rounded-xl border border-fb-border bg-fb-main p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("tripArchive.title")}</h2>
              <button type="button" onClick={() => setArchiveOpen(false)}>{t("tripArchive.close")}</button>
            </div>
            <p className="mb-4 text-sm text-fb-muted">{t("tripArchive.retention")}</p>
            {archiveError && <p role="alert" className="mb-3 text-red-500">{archiveError}</p>}
            {archivedTrips.length === 0 && <p>{t("tripArchive.empty")}</p>}
            {archivedTrips.map((trip) => (
              <div key={trip.id} className="mb-3 rounded-lg border border-fb-border p-3">
                <div className="font-medium">{new Date(trip.startedAt).toLocaleString(locale)}</div>
                <div className="text-xs text-fb-muted">{t("tripArchive.purgeAt")}: {new Date(trip.purgeAt).toLocaleDateString(locale)}</div>
                <div className="mt-2 flex gap-2">
                  <button disabled={archiveBusy} onClick={() => changeTrip(trip.id, 'restore')} className="rounded border border-fb-border px-3 py-1.5 text-sm">{t("tripArchive.restore")}</button>
                  <button disabled={archiveBusy} onClick={() => changeTrip(trip.id, 'delete')} className="rounded border border-red-500 px-3 py-1.5 text-sm text-red-500">{t("tripArchive.deleteForever")}</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {selectedTripId && (
          <div className="absolute bottom-4 right-4 z-20 w-[min(420px,calc(100%-2rem))] overflow-hidden rounded-xl border border-fb-border bg-fb-main/95 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-fb-border px-4 py-3">
              <div>
                <div className="font-semibold">{t('tripDetails.title')}</div>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => setDetailsTab('details')} className={detailsTab === 'details' ? 'font-semibold text-fb-accent' : 'text-fb-muted'}>{t('tripDetails.details')}</button>
                  <button type="button" onClick={() => setDetailsTab('history')} className={detailsTab === 'history' ? 'font-semibold text-fb-accent' : 'text-fb-muted'}>{t('tripDetails.history')}</button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTripId(null)}
                className="rounded-lg border border-fb-border px-2 py-1 text-xs text-fb-muted hover:border-fb-accent hover:text-fb-accent"
              >
                Schließen
              </button>
            </div>

            {detailsTab === 'details' && selectedTrip && (
              <div className="max-h-[50vh] overflow-y-auto border-b border-fb-border p-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-fb-muted">{t('tripDetails.start')}</span><div>{formatDate(selectedTrip.startedAt)}</div></div>
                  <div><span className="text-fb-muted">{t('tripDetails.end')}</span><div>{selectedTrip.endedAt ? formatDate(selectedTrip.endedAt) : '–'}</div></div>
                  <div><span className="text-fb-muted">{t('tripDetails.from')}</span><div>{selectedTrip.startAddress || '–'}</div></div>
                  <div><span className="text-fb-muted">{t('tripDetails.to')}</span><div>{selectedTrip.endAddress || '–'}</div></div>
                  <div><span className="text-fb-muted">{t('tripDetails.distance')}</span><div>{formatDistance(selectedTrip.distanceMeters)}</div></div>
                  <div><span className="text-fb-muted">{t('tripDetails.vehicle')}</span><div>{selectedTrip.vehicle?.name || '–'}</div></div>
                </div>
                <label className="mt-3 block font-medium">{t('tripDetails.category')}
                  <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="mt-1 w-full rounded border border-fb-border bg-fb-surface p-2">
                    {['unclassified','private','business','commute'].map((type) => <option key={type} value={type}>{tripTypeLabels[type]}</option>)}
                  </select>
                </label>
                <div className="mt-3 font-medium">{t('tripDetails.tags')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {data.filters.tags.map((tag) => <label key={tag.id} className="flex items-center gap-1 rounded border border-fb-border px-2 py-1">
                    <input type="checkbox" checked={editTags.includes(tag.id)} onChange={(e) => setEditTags((prev) => e.target.checked ? [...prev,tag.id] : prev.filter((id) => id !== tag.id))} />
                    {tag.name}
                  </label>)}
                  {data.filters.tags.length === 0 && <span className="text-fb-muted">{t('tripDetails.noTags')}</span>}
                </div>
                {editError && <p role="alert" className="mt-2 text-red-500">{editError}</p>}
                <button type="button" disabled={editBusy} onClick={saveTripDetails} className="mt-3 rounded bg-fb-accent px-4 py-2 font-semibold text-fb-accent-text disabled:opacity-50">{t('tripDetails.save')}</button>
              </div>
            )}
            <div className="border-b border-fb-border p-3">
              <button type="button" disabled={archiveBusy} onClick={() => changeTrip(selectedTripId, 'archive')} className="mb-3 rounded-lg border border-red-500 px-3 py-2 text-sm text-red-500">{t("tripArchive.moveToArchive")}</button>
              {archiveError && <p role="alert" className="mb-2 text-red-500">{archiveError}</p>}
              {selectedTrip?.reconciliationMetadata?.splitRecommended && (
                <div className="mb-3 rounded-lg border border-fb-accent bg-fb-accent-soft p-3 text-sm">
                  <div className="font-semibold">Aus mehreren Geräten zusammengeführt</div>
                  <div className="mt-1 text-xs text-fb-muted">Die Aufteilung dieser Fahrt sollte geprüft werden.</div>
                  <button type="button" onClick={() => { setMapMode("split"); beginSplit(); }} className="mt-2 rounded-lg bg-fb-accent px-3 py-1.5 text-xs font-semibold text-fb-accent-text">Aufteilung prüfen</button>
                </div>
              )}
              {driverAssignment.drivers.length > 0 && (() => {
                const returnOnly = driverAssignment.drivers.every((driver) => driver.returnOnly);
                return (
                  <div className="mb-3 rounded-lg border border-fb-border bg-fb-surface p-3">
                    <div className="text-xs font-semibold">{returnOnly ? "Fahrt an Besitzer zurückgeben" : "Fahrer zuweisen"}</div>
                    {returnOnly ? (
                      <>
                        <div className="mt-1 text-xs text-fb-muted">Du kannst diese Fahrt nicht an andere Benutzer verschieben. Wenn du nicht gefahren bist, kannst du sie an den Fahrzeugbesitzer zurückgeben.</div>
                        <button type="button" onClick={() => setDriverAssignment((s)=>({...s,selected:s.drivers[0]?.userId || "",reason:"Ich bin nicht gefahren."}))} className="mt-2 rounded-lg border border-fb-border px-3 py-1.5 text-xs font-semibold hover:border-fb-accent">Ich bin nicht gefahren</button>
                        <textarea value={driverAssignment.reason} onChange={(e)=>setDriverAssignment((s)=>({...s,reason:e.target.value,selected:s.selected || s.drivers[0]?.userId || ""}))} placeholder="Oder eigenen Grund angeben …" maxLength={500} className="mt-2 min-h-16 w-full rounded-lg border border-fb-border bg-fb-main px-2 py-1.5 text-sm" />
                        <button type="button" disabled={!driverAssignment.reason.trim() || tripAction.busy} onClick={() => { if (!driverAssignment.selected) setDriverAssignment((s)=>({...s,selected:s.drivers[0]?.userId || ""})); performDriverAssignment(); }} className="mt-2 rounded-lg bg-fb-accent px-3 py-1.5 text-xs font-semibold text-fb-accent-text disabled:opacity-50">An Besitzer zurückgeben</button>
                      </>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <select value={driverAssignment.selected} onChange={(e)=>setDriverAssignment((s)=>({...s,selected:e.target.value}))} className="min-w-0 flex-1 rounded-lg border border-fb-border bg-fb-main px-2 py-1.5 text-sm">
                          <option value="">Benutzer auswählen …</option>
                          {driverAssignment.drivers.map((driver)=><option key={driver.userId} value={driver.userId}>{driver.displayName || driver.username}{driver.isOwner ? " (Besitzer)" : ""}</option>)}
                        </select>
                        <button type="button" disabled={!driverAssignment.selected || tripAction.busy} onClick={performDriverAssignment} className="rounded-lg bg-fb-accent px-3 py-1.5 text-xs font-semibold text-fb-accent-text disabled:opacity-50">Zuweisen</button>
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={tripAction.busy}
                onClick={() => { setMapMode("split"); setTripAction((s)=>({...s,splitPoints:null,error:""})); }}
                className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent disabled:opacity-50"
              >
                Auf Karte teilen
              </button>
              <button
                type="button"
                disabled={tripAction.busy}
                onClick={() => { setMapMode("correct"); setRouteDraft([]); }}
                className="rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent disabled:opacity-50"
              >
                Route korrigieren
              </button>
              </div>
              {mapMode === "split" && <div className="mt-2 text-xs text-fb-muted">Klicke nahe an der gewünschten Trennstelle auf die Route.</div>}
              {mapMode === "correct" && (
                <div className="mt-2">
                  <div className="text-xs text-fb-muted">Klicke die korrigierte Route der Reihe nach auf der Karte ab.</div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setRouteDraft((p)=>p.slice(0,-1))} className="rounded border border-fb-border px-2 py-1 text-xs">Letzten Punkt entfernen</button>
                    <button type="button" disabled={routeDraft.length < 2 || tripAction.busy} onClick={saveRouteCorrection} className="rounded bg-fb-accent px-2 py-1 text-xs font-semibold text-fb-accent-text disabled:opacity-50">Route speichern</button>
                  </div>
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="mt-3 rounded-lg border border-fb-border bg-fb-surface p-2">
                  <div className="text-xs font-semibold">Klassifizierungsvorschlag</div>
                  {suggestions.slice(0,3).map((suggestion,index) => (
                    <div key={index} className="mt-1 text-xs text-fb-muted">{suggestion.reason}: {tripTypeLabels[suggestion.type] || suggestion.type}</div>
                  ))}
                </div>
              )}
              <button
                type="button"
                disabled={tripAction.busy}
                onClick={beginSplit}
                className="w-full rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold hover:border-fb-accent hover:text-fb-accent disabled:opacity-50"
              >
                Fahrt teilen
              </button>
              {tripAction.error && <div className="mt-2 text-xs text-fb-danger">{tripAction.error}</div>}
              {tripAction.splitPoints && (
                <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-fb-border bg-fb-surface p-2">
                  <div className="mb-2 text-xs text-fb-muted">Trennpunkt auswählen</div>
                  {tripAction.splitPoints.map((point) => (
                    <button
                      key={point.id}
                      type="button"
                      onClick={() => performSplit(point.id)}
                      className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-fb-accent-soft"
                    >
                      {formatDate(point.recordedAt)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {detailsTab === 'history' && <div className="max-h-72 overflow-y-auto p-3">
              {history.loading ? (
                <div className="px-1 py-3 text-sm text-fb-muted">
                  Historie wird geladen …
                </div>
              ) : history.error ? (
                <div className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger">
                  {history.error}
                </div>
              ) : history.entries.length === 0 ? (
                <div className="px-1 py-3 text-sm text-fb-muted">
                  Noch keine Historieneinträge vorhanden.
                </div>
              ) : (
                <div className="space-y-2">
                  {history.entries.map((entry) => {
                    const summary = historySummary(entry);
                    const actor =
                      entry.actor?.displayName ||
                      entry.actor?.username ||
                      entry.actor?.email ||
                      "System";

                    return (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-fb-border bg-fb-surface px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-medium text-sm">
                            {historyEventLabels[entry.eventType] || entry.eventType}
                          </div>
                          <time className="shrink-0 text-[11px] text-fb-muted">
                            {formatDate(entry.createdAt)}
                          </time>
                        </div>
                        {summary && (
                          <div className="mt-1 text-xs text-fb-muted">
                            {summary}
                          </div>
                        )}
                        <div className="mt-1 text-[11px] text-fb-muted">
                          {actor}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>}
          </div>
        )}

        {!status.loading &&
          data.trips.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 hidden justify-center px-4 md:flex">
              <div className="rounded-lg border border-fb-border bg-fb-main/95 px-4 py-3 text-center text-sm shadow-lg backdrop-blur">
                {data.map.homeLocation ? (
                  <>
                    <div className="font-semibold">
                      Heimatort
                    </div>
                    <div className="mt-1 text-fb-muted">
                      {
                        data.map.homeLocation
                          .address
                      }
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">
                      Kein Heimatort hinterlegt
                    </div>
                    <div className="mt-1 text-fb-muted">
                      Lege ihn unter Eigene
                      Einstellungen fest.
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
      </section>
    </div>
  );
}
