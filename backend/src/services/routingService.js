import { serviceUnavailable } from "../lib/errors.js";
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

function result(provider, distanceMeters, durationSeconds) {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw serviceUnavailable("ROUTING_FAILED", "Der Routing-Dienst hat keine Strecke geliefert.");
  }
  return {
    provider,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
  };
}

/** Straßenstrecke (Auto) zwischen zwei Koordinaten. */
export async function routeBetween(from, to, client) {
  const routing = resolveRouting(await getAdminServiceSettings(client));
  if (!routing.enabled) {
    throw serviceUnavailable("ROUTING_DISABLED", "Es ist kein Routing-Dienst eingerichtet.");
  }

  if (routing.provider === "atlas") {
    const url = new URL(routing.url);
    url.searchParams.set("from", `${from.lat},${from.lon}`);
    url.searchParams.set("to", `${to.lat},${to.lon}`);
    url.searchParams.set("mode", "auto");
    const data = await request(url, {}, routing.timeoutMs);
    // Valhalla-Einheiten: Kilometer und Sekunden
    return result("atlas", Number(data?.data?.summary?.length) * 1000, Number(data?.data?.summary?.time));
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
    return result("valhalla", Number(data?.trip?.summary?.length) * 1000, Number(data?.trip?.summary?.time));
  }

  const url = new URL(`${routing.url}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}`);
  url.searchParams.set("overview", "false");
  const data = await request(url, {}, routing.timeoutMs);
  const route = data?.routes?.[0];
  return result("osrm", Number(route?.distance), Number(route?.duration));
}
