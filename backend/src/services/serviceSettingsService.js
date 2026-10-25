import { config } from "../config.js";
import { pool } from "../database/pool.js";

const FALLBACKS = {
  "services.map": config.services.map,
  "services.photon": config.services.photon,
  "services.overpass": config.services.overpass,
  "services.atlas": config.services.atlas,
  mapMatching: { provider: "disabled", osrmUrl: "", valhallaUrl: "" },
};

export async function readSetting(key, client = pool) {
  const result = await client.query(
    `SELECT value, updated_at FROM app_settings WHERE key = $1 LIMIT 1`,
    [key],
  );

  return {
    value: result.rows[0]?.value || FALLBACKS[key] || null,
    updatedAt: result.rows[0]?.updated_at || null,
  };
}

export async function writeSetting(
  key,
  value,
  userId,
  { isPublic = false, client = pool } = {},
) {
  const result = await client.query(
    `
      INSERT INTO app_settings (
        key,
        value,
        is_public,
        updated_by_user_id
      )
      VALUES ($1, $2::jsonb, $3, $4)
      ON CONFLICT (key)
      DO UPDATE SET
        value = EXCLUDED.value,
        is_public = EXCLUDED.is_public,
        updated_by_user_id = EXCLUDED.updated_by_user_id
      RETURNING value, updated_at
    `,
    [key, JSON.stringify(value), isPublic, userId],
  );

  return result.rows[0];
}

export async function getAdminServiceSettings(client = pool) {
  const [map, photon, overpass, atlas, mapMatching] = await Promise.all([
    readSetting("services.map", client),
    readSetting("services.photon", client),
    readSetting("services.overpass", client),
    readSetting("services.atlas", client),
    readSetting("mapMatching", client),
  ]);

  return {
    map: map.value,
    photon: photon.value,
    overpass: overpass.value,
    atlas: atlas.value,
    mapMatching: mapMatching.value,
    updatedAt:
      [map.updatedAt, photon.updatedAt, overpass.updatedAt, atlas.updatedAt, mapMatching.updatedAt]
        .filter(Boolean)
        .sort()
        .at(-1) || new Date().toISOString(),
  };
}

const PUBLIC_PHOTON_URL = "https://photon.komoot.io";

function trimUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

/** Atlas ist nur nutzbar, wenn das Modul eingeschaltet und eine Adresse hinterlegt ist. */
export function resolveAtlas(settings) {
  const atlas = settings.atlas || {};
  const baseUrl = trimUrl(atlas.baseUrl);

  return {
    enabled: Boolean(atlas.enabled && baseUrl),
    baseUrl,
    timeoutMs: Number(atlas.timeoutMs || 10_000),
  };
}

/**
 * Welcher Photon-Server Adresssuche und Rückwärts-Geocoding liefert.
 * provider: disabled | public | custom | atlas. Atlas reicht Photon unter
 * /api/v1/photon/* unverändert durch, daher bleibt das Antwortformat gleich.
 */
export function resolvePhoton(settings) {
  const photon = settings.photon || {};
  const provider = photon.provider || "public";
  const timeoutMs = Number(photon.timeoutMs || 10_000);

  if (provider === "disabled") {
    return { enabled: false, provider, reason: "Die Adresssuche ist deaktiviert." };
  }

  if (provider === "atlas") {
    const atlas = resolveAtlas(settings);

    if (!atlas.enabled) {
      return { enabled: false, provider, reason: "Photon soll über Atlas laufen, Atlas ist aber nicht aktiviert." };
    }

    const base = `${atlas.baseUrl}/api/v1/photon`;
    return {
      enabled: true,
      provider,
      searchUrl: `${base}/api`,
      reverseUrl: `${base}/reverse`,
      statusUrl: `${base}/status`,
      timeoutMs: atlas.timeoutMs,
    };
  }

  const base = provider === "custom" ? trimUrl(photon.baseUrl) : trimUrl(photon.baseUrl) || PUBLIC_PHOTON_URL;

  if (!base) {
    return { enabled: false, provider, reason: "Für den eigenen Photon-Server fehlt die Adresse." };
  }

  return {
    enabled: true,
    provider,
    searchUrl: `${base}/api/`,
    reverseUrl: `${base}/reverse`,
    statusUrl: `${base}/status`,
    timeoutMs,
  };
}

/** Welcher Dienst Map-Matching übernimmt. provider: disabled | valhalla | osrm | atlas. */
export function resolveMapMatching(settings) {
  const matching = settings.mapMatching || {};
  const provider = matching.provider || "disabled";

  if (provider === "disabled") {
    return { enabled: false, provider, reason: "Map-Matching ist deaktiviert." };
  }

  if (provider === "atlas") {
    const atlas = resolveAtlas(settings);
    return atlas.enabled
      ? { enabled: true, provider, url: `${atlas.baseUrl}/api/v1/map-match`, timeoutMs: Math.max(atlas.timeoutMs, 30_000) }
      : { enabled: false, provider, reason: "Map-Matching soll über Atlas laufen, Atlas ist aber nicht aktiviert." };
  }

  const url = trimUrl(provider === "valhalla" ? matching.valhallaUrl : matching.osrmUrl);
  return url
    ? { enabled: true, provider, url, timeoutMs: 30_000 }
    : { enabled: false, provider, reason: "Für den Routing-Server fehlt die Adresse." };
}

export async function getPublicServiceConfiguration(client = pool) {
  const settings = await getAdminServiceSettings(client);

  return {
    map: settings.map,
    geocoding: {
      // Additiv: Clients können die Adresssuche ausblenden, wenn sie serverseitig aus ist
      enabled: resolvePhoton(settings).enabled,
      searchEndpoint: "/api/v1/geocoding/search",
      reverseEndpoint: "/api/v1/geocoding/reverse",
    },
    // Additiv: Strecke zwischen zwei Orten über den Map-Matching-Dienst berechnen
    routing: {
      enabled: resolveMapMatching(settings).enabled,
      endpoint: "/api/v1/geocoding/route",
    },
    overpass: {
      nearbyEndpoint: "/api/v1/geocoding/nearby",
      searchRadiusMeters: Number(settings.overpass.searchRadiusMeters || 2500),
      maxResults: Number(settings.overpass.maxResults || 50),
    },
    updatedAt: settings.updatedAt,
  };
}
