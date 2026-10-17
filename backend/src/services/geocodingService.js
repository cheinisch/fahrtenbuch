import { serviceUnavailable } from "../lib/errors.js";
import {
  getAdminServiceSettings,
  resolveAtlas,
  resolveMapMatching,
  resolvePhoton,
} from "./serviceSettingsService.js";

const CATEGORY_FILTERS = {
  sight: [
    '[tourism~"attraction|museum|viewpoint"]',
    '[historic]',
  ],
  restaurant: ['[amenity~"restaurant|cafe|fast_food"]'],
  hotel: ['[tourism~"hotel|guest_house|hostel|motel"]'],
  park: ['[leisure~"park|garden"]'],
  fuel: ['[amenity="fuel"]'],
  parking: ['[amenity="parking"]'],
  supermarket: ['[shop="supermarket"]'],
  charging_station: ['[amenity="charging_station"]'],
  hospital: ['[amenity="hospital"]'],
  pharmacy: ['[amenity="pharmacy"]'],
};

// Netzwerkfehler (DNS, Verbindung abgelehnt, Timeout) in verständliche 503-Fehler übersetzen
function upstreamError(error) {
  if (error?.name === "AbortError") {
    return serviceUnavailable(
      "UPSTREAM_TIMEOUT",
      "Der externe Dienst hat nicht rechtzeitig geantwortet.",
    );
  }

  if (error instanceof TypeError) {
    return serviceUnavailable(
      "UPSTREAM_UNREACHABLE",
      "Der externe Dienst ist nicht erreichbar. Bitte Adresse und Port prüfen.",
    );
  }

  return error;
}

async function fetchJson(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "User-Agent": "Fahrtenbuch/1.0",
        ...options.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw serviceUnavailable(
        "UPSTREAM_ERROR",
        `Der externe Dienst antwortete mit HTTP ${response.status}.`,
      );
    }

    return {
      data: await response.json(),
      responseTimeMs: Date.now() - started,
    };
  } catch (error) {
    throw upstreamError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function buildPhotonAddress(properties = {}) {
  const street = [properties.street, properties.housenumber]
    .filter(Boolean)
    .join(" ");
  const city = [
    properties.postcode,
    properties.city || properties.town || properties.village || properties.county,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    properties.name,
    street,
    city,
    properties.state,
    properties.country,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(", ");
}

function mapPhotonFeature(feature) {
  const coordinates = feature?.geometry?.coordinates || [];
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    id:
      feature.properties?.osm_type && feature.properties?.osm_id
        ? `${feature.properties.osm_type}/${feature.properties.osm_id}`
        : null,
    name: feature.properties?.name || null,
    address:
      buildPhotonAddress(feature.properties) ||
      `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    latitude,
    longitude,
    type: feature.properties?.type || null,
    country: feature.properties?.country || null,
    city:
      feature.properties?.city ||
      feature.properties?.town ||
      feature.properties?.village ||
      null,
    raw: feature.properties || {},
  };
}

async function activePhoton() {
  const photon = resolvePhoton(await getAdminServiceSettings());

  if (!photon.enabled) {
    throw serviceUnavailable("GEOCODING_DISABLED", photon.reason);
  }

  return photon;
}

export async function photonSearch(query, language = "de", limit = 10) {
  const photon = await activePhoton();
  const url = new URL(photon.searchUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("lang", language);
  url.searchParams.set("limit", String(limit));

  const result = await fetchJson(url, {}, photon.timeoutMs);

  return {
    results: (result.data.features || []).map(mapPhotonFeature).filter(Boolean),
    responseTimeMs: result.responseTimeMs,
  };
}

export async function photonReverse(latitude, longitude, language = "de") {
  const photon = await activePhoton();
  const url = new URL(photon.reverseUrl);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("lang", language);

  const result = await fetchJson(url, {}, photon.timeoutMs);

  return {
    result: (result.data.features || []).map(mapPhotonFeature).find(Boolean) || null,
    responseTimeMs: result.responseTimeMs,
  };
}

function buildOverpassQuery(latitude, longitude, category, settings) {
  const filters = CATEGORY_FILTERS[category] || [];
  const radius = Number(settings.searchRadiusMeters || 2500);
  const maxResults = Number(settings.maxResults || 50);
  const clauses = [];

  for (const filter of filters) {
    clauses.push(`node(around:${radius},${latitude},${longitude})${filter};`);
    clauses.push(`way(around:${radius},${latitude},${longitude})${filter};`);
    clauses.push(`relation(around:${radius},${latitude},${longitude})${filter};`);
  }

  return `
    [out:json][timeout:${Math.max(5, Math.ceil(Number(settings.timeoutMs || 30000) / 1000))}];
    (
      ${clauses.join("\n")}
    );
    out center tags ${maxResults};
  `;
}

function mapOverpassElement(element) {
  const latitude = Number(element.lat ?? element.center?.lat);
  const longitude = Number(element.lon ?? element.center?.lon);
  const tags = element.tags || {};

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const address = [
    [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
    [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return {
    id: `${element.type}/${element.id}`,
    osmType: element.type,
    osmId: element.id,
    latitude,
    longitude,
    name: tags.name || tags.brand || tags.operator || null,
    category:
      tags.amenity ||
      tags.tourism ||
      tags.leisure ||
      tags.shop ||
      tags.historic ||
      null,
    address: address || null,
    tags,
  };
}

export async function overpassNearby(latitude, longitude, category) {
  const settings = await getAdminServiceSettings();
  const overpass = settings.overpass;
  const query = buildOverpassQuery(latitude, longitude, category, overpass);
  const body = new URLSearchParams({ data: query });

  const result = await fetchJson(
    overpass.interpreterUrl || "https://overpass-api.de/api/interpreter",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
    },
    Number(overpass.timeoutMs || 30_000),
  );

  return {
    results: (result.data.elements || [])
      .map(mapOverpassElement)
      .filter(Boolean)
      .slice(0, Number(overpass.maxResults || 50)),
    responseTimeMs: result.responseTimeMs,
  };
}

// ---------------------------------------------------------------------------
// Systemcheck: jedes Modul einzeln prüfen. Gemeinsam genutzt vom Systemcheck
// (gespeicherte Einstellungen) und den Test-Buttons (noch ungespeicherte Werte).

const PROVIDER_LABELS = {
  public: "öffentlicher Server",
  custom: "eigener Server",
  atlas: "Dawarich Atlas",
  valhalla: "eigener Valhalla-Server",
  osrm: "eigener OSRM-Server",
  disabled: "deaktiviert",
};

async function timed(fn) {
  const started = Date.now();
  const result = await fn();
  const { message, details } = typeof result === "string" ? { message: result } : result;
  return { message, details: details || null, responseTimeMs: Date.now() - started };
}

/** Dienst antwortet, ist aber noch im Aufbau (z. B. Valhalla baut Kacheln). */
function startingError(message) {
  const error = serviceUnavailable("SERVICE_STARTING", message);
  error.checkState = "starting";
  return error;
}

async function checkAtlas(atlas) {
  return timed(async () => {
    const [health, version] = await Promise.all([
      fetchJson(`${atlas.baseUrl}/api/v1/health`, {}, atlas.timeoutMs),
      fetchJson(`${atlas.baseUrl}/api/v1/version`, {}, atlas.timeoutMs).catch(() => null),
    ]);
    const capabilities = health.data?.data?.capabilities || {};
    const names = { geocoding: "Geocoding", routing: "Routing", pois: "POIs", transit: "ÖPNV" };
    const parts = Object.entries(names)
      .filter(([key]) => capabilities[key])
      .map(([key, label]) => `${label}: ${{ up: "aktiv", starting: "startet", down: "aus" }[capabilities[key]] || capabilities[key]}`);
    const atlasVersion = version?.data?.data?.version || null;
    const versionText = atlasVersion ? `Atlas ${atlasVersion}` : "Atlas erreichbar";

    return {
      message: parts.length ? `${versionText} · ${parts.join(", ")}` : versionText,
      details: {
        version: atlasVersion,
        status: health.data?.data?.status || null,
        capabilities,
      },
    };
  });
}

async function checkPhoton(photon) {
  return timed(async () => {
    const url = new URL(photon.searchUrl);
    url.searchParams.set("q", "Berlin");
    url.searchParams.set("limit", "1");
    const result = await fetchJson(url, {}, photon.timeoutMs);

    if (!Array.isArray(result.data?.features)) {
      throw serviceUnavailable("PHOTON_INVALID_RESPONSE", "Der Server antwortet, aber nicht wie ein Photon-Server.");
    }

    return "Adresssuche und Rückwärts-Geocoding verfügbar.";
  });
}

async function checkOsrm(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    // Beliebiger Punkt; OSRM antwortet auch außerhalb des Extrakts mit JSON
    const response = await fetch(`${url}/nearest/v1/driving/8.6821,50.1109`, {
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);

    if (!data?.code) {
      throw serviceUnavailable("OSRM_TEST_FAILED", `OSRM antwortete mit HTTP ${response.status}.`);
    }
  } catch (error) {
    throw upstreamError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function checkMapMatching(matching, settings) {
  return timed(async () => {
    if (matching.provider === "valhalla") {
      // /status liefert die Version, ohne Routing-Last zu erzeugen
      const result = await fetchJson(`${matching.url}/status`, {}, 10_000);
      return result.data?.version
        ? `Valhalla ${result.data.version} erreichbar.`
        : "Valhalla erreichbar.";
    }

    if (matching.provider === "osrm") {
      await checkOsrm(matching.url);
      return "OSRM erreichbar.";
    }

    // Atlas: Routing-Fähigkeit aus dem Health-Endpunkt
    const atlas = resolveAtlas(settings);
    const health = await fetchJson(`${atlas.baseUrl}/api/v1/health`, {}, atlas.timeoutMs);
    const routing = health.data?.data?.capabilities?.routing;

    if (routing === "starting") {
      throw startingError("Atlas startet das Routing noch (Valhalla baut ggf. Kacheln).");
    }

    if (routing !== "up") {
      throw serviceUnavailable(
        "ATLAS_ROUTING_DOWN",
        "Atlas ist erreichbar, aber das Routing (Valhalla) ist nicht aktiv.",
      );
    }

    return "Map-Matching über Atlas verfügbar.";
  });
}

function inactiveResult(module, label, provider, reason, state = "inactive") {
  return { module, label, provider, providerLabel: PROVIDER_LABELS[provider] || provider, state, message: reason, details: null, responseTimeMs: null };
}

async function runCheck(module, label, provider, fn) {
  try {
    const result = await fn();
    return { module, label, provider, providerLabel: PROVIDER_LABELS[provider] || provider, state: "available", ...result };
  } catch (error) {
    return {
      module,
      label,
      provider,
      providerLabel: PROVIDER_LABELS[provider] || provider,
      state: error?.checkState || "unavailable",
      message: error?.message || "Prüfung fehlgeschlagen.",
      details: null,
      responseTimeMs: null,
    };
  }
}

const MODULE_LABELS = {
  atlas: "Dawarich Atlas",
  geocoding: "Adresssuche (Photon)",
  mapMatching: "Map-Matching (Valhalla)",
};

export const SERVICE_MODULES = Object.keys(MODULE_LABELS);

/** Prüft ein Modul anhand eines Einstellungs-Objekts (gespeichert oder Kandidat). */
export async function checkModule(module, settings) {
  const label = MODULE_LABELS[module];

  if (module === "atlas") {
    const atlas = resolveAtlas(settings);
    if (!atlas.enabled) {
      return inactiveResult(module, label, "disabled", settings.atlas?.enabled ? "Für Atlas fehlt die Adresse." : "Atlas ist nicht aktiviert.", settings.atlas?.enabled ? "misconfigured" : "inactive");
    }
    return runCheck(module, label, "atlas", () => checkAtlas(atlas));
  }

  if (module === "geocoding") {
    const photon = resolvePhoton(settings);
    if (!photon.enabled) {
      return inactiveResult(module, label, photon.provider, photon.reason, photon.provider === "disabled" ? "inactive" : "misconfigured");
    }
    return runCheck(module, label, photon.provider, () => checkPhoton(photon));
  }

  if (module === "mapMatching") {
    const matching = resolveMapMatching(settings);
    if (!matching.enabled) {
      return inactiveResult(module, label, matching.provider, matching.reason, matching.provider === "disabled" ? "inactive" : "misconfigured");
    }
    return runCheck(module, label, matching.provider, () => checkMapMatching(matching, settings));
  }

  throw serviceUnavailable("UNKNOWN_MODULE", "Unbekanntes Modul.");
}

/** Systemcheck über alle Module mit den gespeicherten Einstellungen. */
export async function runSystemCheck(modules = SERVICE_MODULES) {
  const settings = await getAdminServiceSettings();
  const results = await Promise.all(modules.map((module) => checkModule(module, settings)));
  return { checkedAt: new Date().toISOString(), modules: results };
}

export async function testService(category, candidateConfig) {
  const started = Date.now();

  // Neue Modul-Tests mit ungespeicherten Werten; Atlas-Werte kommen ggf. mit
  if (["atlas", "geocoding", "mapMatching"].includes(category)) {
    const saved = await getAdminServiceSettings();
    const candidate = {
      ...saved,
      atlas: candidateConfig.atlas || saved.atlas,
      ...(category === "atlas" ? { atlas: candidateConfig } : {}),
      ...(category === "geocoding" ? { photon: candidateConfig } : {}),
      ...(category === "mapMatching" ? { mapMatching: candidateConfig } : {}),
    };
    const result = await checkModule(category, candidate);

    if (result.state !== "available" && result.state !== "starting") {
      throw serviceUnavailable("SERVICE_TEST_FAILED", result.message);
    }

    return {
      success: true,
      state: result.state,
      responseTimeMs: result.responseTimeMs,
      message: result.message,
      details: result.details,
    };
  }

  if (category === "photon") {
    const photon = resolvePhoton({ photon: { provider: "custom", ...candidateConfig, baseUrl: candidateConfig.baseUrl || "https://photon.komoot.io" } });
    await checkPhoton(photon);
  } else if (category === "valhalla" || category === "osrm") {
    const matching = resolveMapMatching({ mapMatching: { provider: category, ...candidateConfig } });
    if (!matching.enabled) {
      throw serviceUnavailable("ROUTING_URL_REQUIRED", matching.reason);
    }
    const result = await checkMapMatching(matching, {});
    return { success: true, responseTimeMs: Date.now() - started, message: result.message };
  } else if (category === "overpass") {
    const query = "[out:json][timeout:10];node(around:10,52.5200,13.4050)[amenity];out 1;";
    await fetchJson(
      candidateConfig.interpreterUrl || "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
      },
      Number(candidateConfig.timeoutMs || 30_000),
    );
  } else if (category === "map") {
    const urlText = candidateConfig.styleUrl || candidateConfig.tileUrl;

    if (!urlText) {
      throw serviceUnavailable("MAP_URL_REQUIRED", "Karten-URL fehlt.");
    }

    const testUrl = String(urlText)
      .replace("{z}", "0")
      .replace("{x}", "0")
      .replace("{y}", "0");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(testUrl, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw serviceUnavailable(
          "MAP_TEST_FAILED",
          `Kartenquelle antwortete mit HTTP ${response.status}.`,
        );
      }
    } catch (error) {
      throw upstreamError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    success: true,
    responseTimeMs: Date.now() - started,
    message: "Verbindung erfolgreich.",
  };
}
