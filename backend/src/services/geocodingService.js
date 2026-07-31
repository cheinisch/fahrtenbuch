import { serviceUnavailable } from "../lib/errors.js";
import { getAdminServiceSettings } from "./serviceSettingsService.js";

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

function normalizedBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
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
    if (error?.name === "AbortError") {
      throw serviceUnavailable(
        "UPSTREAM_TIMEOUT",
        "Der externe Dienst hat nicht rechtzeitig geantwortet.",
      );
    }

    throw error;
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

export async function photonSearch(query, language = "de", limit = 10) {
  const settings = await getAdminServiceSettings();
  const photon = settings.photon;
  const baseUrl = normalizedBaseUrl(photon.baseUrl || "https://photon.komoot.io");
  const url = new URL(`${baseUrl}/api/`);
  url.searchParams.set("q", query);
  url.searchParams.set("lang", language);
  url.searchParams.set("limit", String(limit));

  const result = await fetchJson(url, {}, Number(photon.timeoutMs || 10_000));

  return {
    results: (result.data.features || []).map(mapPhotonFeature).filter(Boolean),
    responseTimeMs: result.responseTimeMs,
  };
}

export async function photonReverse(latitude, longitude, language = "de") {
  const settings = await getAdminServiceSettings();
  const photon = settings.photon;
  const baseUrl = normalizedBaseUrl(photon.baseUrl || "https://photon.komoot.io");
  const url = new URL(`${baseUrl}/reverse`);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("lang", language);

  const result = await fetchJson(url, {}, Number(photon.timeoutMs || 10_000));

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

export async function testService(category, candidateConfig) {
  const started = Date.now();

  if (category === "photon") {
    const baseUrl = normalizedBaseUrl(
      candidateConfig.baseUrl || "https://photon.komoot.io",
    );
    const url = new URL(`${baseUrl}/api/`);
    url.searchParams.set("q", "Berlin");
    url.searchParams.set("limit", "1");
    await fetchJson(url, {}, Number(candidateConfig.timeoutMs || 10_000));
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
