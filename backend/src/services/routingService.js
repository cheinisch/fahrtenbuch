import { badRequest, serviceUnavailable } from "../lib/errors.js";
import { haversineDistance } from "../lib/geo.js";
import { decodePolyline6 } from "../lib/trace.js";
import { getAdminServiceSettings, resolveAtlas, resolveMapMatching } from "./serviceSettingsService.js";

const TIMEOUT_MS = 20_000;

/**
 * Routing-Dienst für Strecken zwischen zwei Orten (z. B. manuell angelegte Fahrten).
 * Nutzt denselben Dienst wie das Map-Matching: Atlas (/api/v1/route), Valhalla (/route)
 * oder OSRM (/route/v1/driving).
 */
export function resolveRouting(settings) {
  const matching = resolveMapMatching(settings);
  if (!matching.enabled) return { enabled: false, reason: matching.reason };
  if (matching.provider === "atlas") {
    const atlas = resolveAtlas(settings);
    return { enabled: true, provider: "atlas", url: `${atlas.baseUrl}/api/v1/route`, timeoutMs: Math.max(atlas.timeoutMs, TIMEOUT_MS) };
  }
  return { enabled: true, provider: matching.provider, url: matching.url, timeoutMs: TIMEOUT_MS };
}

export async function isRoutingAvailable(client) {
  try {
    return resolveRouting(await getAdminServiceSettings(client)).enabled;
  } catch {
    return false;
  }
}

async function request(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      headers: { Accept: "application/json", "User-Agent": "Fahrtenbuch/1.0", ...options?.headers },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw serviceUnavailable("ROUTING_FAILED", `Der Routing-Dienst konnte keine Strecke berechnen (HTTP ${response.status}).`);
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw serviceUnavailable(
      "ROUTING_UNREACHABLE",
      error.name === "AbortError" ? "Der Routing-Dienst hat nicht rechtzeitig geantwortet." : "Der Routing-Dienst ist nicht erreichbar.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function result(provider, distanceMeters, durationSeconds, coordinates = null) {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw serviceUnavailable("ROUTING_FAILED", "Der Routing-Dienst hat keine Strecke geliefert.");
  }
  return {
    provider,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
    // [[lat, lon], …] – nur wenn angefordert
    ...(coordinates ? { coordinates } : {}),
  };
}

function legsShape(legs = []) {
  const route = [];
  for (const leg of legs) {
    const shape = typeof leg?.shape === "string" ? decodePolyline6(leg.shape) : [];
    route.push(...(route.length ? shape.slice(1) : shape));
  }
  return route;
}

async function routeWith(routing, from, to, { geometry = false } = {}) {
  if (routing.provider === "atlas") {
    const url = new URL(routing.url);
    url.searchParams.set("from", `${from.lat},${from.lon}`);
    url.searchParams.set("to", `${to.lat},${to.lon}`);
    url.searchParams.set("mode", "auto");
    const data = await request(url, {}, routing.timeoutMs);
    // Valhalla-Einheiten: Kilometer und Sekunden
    return result("atlas", Number(data?.data?.summary?.length) * 1000, Number(data?.data?.summary?.time),
      geometry ? legsShape(data?.data?.legs) : null);
  }

  if (routing.provider === "valhalla") {
    const data = await request(`${routing.url}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
        costing: "auto",
        units: "kilometers",
        directions_type: "none",
      }),
    }, routing.timeoutMs);
    return result("valhalla", Number(data?.trip?.summary?.length) * 1000, Number(data?.trip?.summary?.time),
      geometry ? legsShape(data?.trip?.legs) : null);
  }

  const url = new URL(`${routing.url}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}`);
  url.searchParams.set("overview", geometry ? "full" : "false");
  if (geometry) url.searchParams.set("geometries", "geojson");
  const data = await request(url, {}, routing.timeoutMs);
  const route = data?.routes?.[0];
  return result("osrm", Number(route?.distance), Number(route?.duration),
    geometry ? (route?.geometry?.coordinates || []).map(([lon, lat]) => [lat, lon]) : null);
}

async function enabledRouting(client) {
  const routing = resolveRouting(await getAdminServiceSettings(client));
  if (!routing.enabled) {
    throw serviceUnavailable("ROUTING_DISABLED", "Es ist kein Routing-Dienst eingerichtet.");
  }
  return routing;
}

/** Straßenstrecke (Auto) zwischen zwei Koordinaten. */
export async function routeBetween(from, to, client) {
  return routeWith(await enabledRouting(client), from, to);
}

// Abstände darunter gelten als zusammenhängende Spur und werden nicht geroutet
export const DEFAULT_GAP_METERS = 250;
export const MAX_ROUTED_GAPS = 60;
const PARALLEL_REQUESTS = 4;

/** Indizes i, bei denen zwischen Punkt i und i+1 eine Lücke über gapMeters liegt. */
export function findPathGaps(points, gapMeters = DEFAULT_GAP_METERS) {
  const gaps = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (haversineDistance(points[i], points[i + 1]) > gapMeters) gaps.push(i);
  }
  return gaps;
}

/**
 * Pfad durch alle Punkte, Lücken über die Straße geroutet: Jeder zusätzliche Punkt
 * lenkt die Route. Liefert die Gesamtstrecke und je Koordinate, ob sie ein Eingabepunkt
 * (index) oder eine geroutete Ergänzung (index null) ist.
 */
export async function routePath(points, { gapMeters = DEFAULT_GAP_METERS, client } = {}) {
  const routing = await enabledRouting(client);
  const gaps = findPathGaps(points, gapMeters);
  if (gaps.length > MAX_ROUTED_GAPS) {
    throw badRequest("TOO_MANY_GAPS", `Zu viele Lücken für die Straßenführung (${gaps.length}, höchstens ${MAX_ROUTED_GAPS}).`);
  }

  const fills = new Map();
  const failed = [];
  for (let start = 0; start < gaps.length; start += PARALLEL_REQUESTS) {
    const batch = gaps.slice(start, start + PARALLEL_REQUESTS);
    const results = await Promise.allSettled(batch.map((i) => routeWith(routing, points[i], points[i + 1], { geometry: true })));
    results.forEach((outcome, offset) => {
      const i = batch[offset];
      // Lücke, die der Dienst nicht routen kann, bleibt eine gerade Linie
      if (outcome.status === "fulfilled" && outcome.value.coordinates?.length >= 2) fills.set(i, outcome.value.coordinates);
      else failed.push(i);
    });
  }

  const path = [];
  points.forEach((point, index) => {
    path.push({ lat: point.lat, lon: point.lon, index });
    const fill = fills.get(index);
    // Erste und letzte Routenkoordinate liegen am Straßennetz neben den Eingabepunkten – weglassen
    if (fill) for (const [lat, lon] of fill.slice(1, -1)) path.push({ lat, lon, index: null });
  });

  let distanceMeters = 0;
  for (let i = 1; i < path.length; i++) distanceMeters += haversineDistance(path[i - 1], path[i]);

  return {
    provider: routing.provider,
    distanceMeters: Math.round(distanceMeters),
    gapCount: gaps.length,
    routedGaps: fills.size,
    failedGaps: failed.length,
    path,
  };
}
