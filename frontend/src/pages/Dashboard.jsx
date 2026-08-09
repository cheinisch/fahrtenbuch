import "leaflet/dist/leaflet.css";

import L from "leaflet";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { getDashboard, getTripHistory } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

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
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function tripCoordinates(trip) {
  return trip.route.map((point) => [
    point.latitude,
    point.longitude,
  ]);
}

function collectCoordinates(trips) {
  return trips.flatMap((trip) =>
    tripCoordinates(trip),
  );
}


export default function Dashboard() {
  const { accessToken } = useAuth();

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const routeLayersRef = useRef(new Map());
  const endpointLayersRef = useRef([]);
  const homeLayerRef = useRef(null);

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
    },
  });

  const [selectedTripId, setSelectedTripId] =
    useState(null);

  const [history, setHistory] = useState({
    loading: false,
    error: "",
    entries: [],
  });

  const [status, setStatus] = useState({
    loading: true,
    error: "",
  });

  const fitAllTrips = useCallback(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const coordinates = collectCoordinates(data.trips);

    if (coordinates.length > 1) {
      map.fitBounds(L.latLngBounds(coordinates), {
        padding: [70, 70],
        maxZoom: 15,
      });
      return;
    }

    if (coordinates.length === 1) {
      map.setView(coordinates[0], 13);
      return;
    }

    const homeLocation = data.map.homeLocation;

    if (homeLocation) {
      map.setView(
        [homeLocation.latitude, homeLocation.longitude],
        12,
      );
      return;
    }

    map.setView([51.1657, 10.4515], 5);
  }, [data.map.homeLocation, data.trips]);

  const updateMapData = useCallback(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    for (const layer of routeLayersRef.current.values()) {
      layer.remove();
    }
    routeLayersRef.current.clear();

    for (const layer of endpointLayersRef.current) {
      layer.remove();
    }
    endpointLayersRef.current = [];

    if (homeLayerRef.current) {
      homeLayerRef.current.remove();
      homeLayerRef.current = null;
    }

    const rootStyles = getComputedStyle(document.documentElement);
    const accent =
      rootStyles.getPropertyValue("--color-accent").trim() || "#f48120";

    for (const trip of data.trips) {
      const coordinates = tripCoordinates(trip);

      if (coordinates.length >= 2) {
        const selected = selectedTripId === trip.id;
        const routeLayer = L.polyline(coordinates, {
          color: accent,
          weight: selected ? 6 : 4,
          opacity: selected ? 1 : 0.72,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);

        routeLayer.on("click", () => setSelectedTripId(trip.id));
        routeLayersRef.current.set(trip.id, routeLayer);
      }

      if (coordinates.length > 0) {
        const start = coordinates[0];
        const end = coordinates[coordinates.length - 1];
        const markerOptions = {
          radius: 5,
          color: "#ffffff",
          weight: 2,
          fillColor: accent,
          fillOpacity: 1,
        };

        endpointLayersRef.current.push(
          L.circleMarker(start, markerOptions).addTo(map),
        );

        if (start[0] !== end[0] || start[1] !== end[1]) {
          endpointLayersRef.current.push(
            L.circleMarker(end, markerOptions).addTo(map),
          );
        }
      }
    }

    const homeLocation = data.map.homeLocation;
    if (homeLocation) {
      homeLayerRef.current = L.circleMarker(
        [homeLocation.latitude, homeLocation.longitude],
        {
          radius: 8,
          color: accent,
          weight: 4,
          fillColor: "#ffffff",
          fillOpacity: 1,
        },
      )
        .bindTooltip(homeLocation.address || "Heimatort")
        .addTo(map);
    }
  }, [data.map.homeLocation, data.trips, selectedTripId]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([51.1657, 10.4515], 5);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      minZoom: 0,
      maxZoom: 19,
      attribution: "© OpenStreetMap-Mitwirkende",
    }).addTo(map);

    mapRef.current = map;

    // Das Dashboard liegt in einem responsiven Grid. Nach dem ersten Layout
    // muss Leaflet die tatsächlich verfügbare Containergröße neu einlesen.
    requestAnimationFrame(() => map.invalidateSize(false));
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize(false);
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      routeLayersRef.current.clear();
      endpointLayersRef.current = [];
      homeLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    updateMapData();
  }, [updateMapData]);

  useEffect(() => {
    fitAllTrips();
  }, [fitAllTrips]);

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
          setSelectedTripId(null);
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
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedTripId) {
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
  }, [accessToken, selectedTripId]);

  function selectTrip(trip) {
    setSelectedTripId(trip.id);

    const coordinates = tripCoordinates(trip);

    const map = mapRef.current;

    if (!map || coordinates.length === 0) {
      return;
    }

    if (coordinates.length === 1) {
      map.setView(coordinates[0], 14);
      return;
    }

    map.fitBounds(L.latLngBounds(coordinates), {
      padding: [80, 80],
      maxZoom: 16,
    });
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
    <div className="grid h-[calc(100vh-6rem)] min-h-[640px] gap-4 xl:grid-cols-[430px_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-fb-border bg-fb-main shadow-sm">
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
                <button
                  key={trip.id}
                  type="button"
                  onClick={() => selectTrip(trip)}
                  className={[
                    "block w-full p-4 text-left transition",
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
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="relative min-h-[420px] overflow-hidden rounded-xl border border-fb-border bg-fb-main shadow-sm">
        <div
          ref={mapContainerRef}
          className="absolute inset-0 z-0"
        />

        <div className="absolute left-3 top-3 z-[1000] flex gap-2">
          <button
            type="button"
            onClick={() => {
              setSelectedTripId(null);
              fitAllTrips();
            }}
            className="rounded-lg border border-fb-border bg-fb-main/95 px-3 py-2 text-sm font-semibold text-fb-text shadow-sm backdrop-blur hover:border-fb-accent hover:text-fb-accent"
          >
            Alle Fahrten anzeigen
          </button>
        </div>

        {selectedTripId && (
          <div className="absolute bottom-3 right-3 z-[1000] w-[min(420px,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-fb-border bg-fb-main/95 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between border-b border-fb-border px-4 py-3">
              <div>
                <div className="font-semibold">Historie</div>
                <div className="text-xs text-fb-muted">
                  Unveränderliche Änderungen dieser Fahrt
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

            <div className="max-h-72 overflow-y-auto p-3">
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
            </div>
          </div>
        )}

        {!status.loading &&
          data.trips.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[1000] flex justify-center px-4">
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
