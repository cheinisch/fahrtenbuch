import { config } from "../config.js";
import { pool } from "../database/pool.js";

const FALLBACKS = {
  "services.map": config.services.map,
  "services.photon": config.services.photon,
  "services.overpass": config.services.overpass,
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
  const [map, photon, overpass] = await Promise.all([
    readSetting("services.map", client),
    readSetting("services.photon", client),
    readSetting("services.overpass", client),
  ]);

  return {
    map: map.value,
    photon: photon.value,
    overpass: overpass.value,
    updatedAt:
      [map.updatedAt, photon.updatedAt, overpass.updatedAt]
        .filter(Boolean)
        .sort()
        .at(-1) || new Date().toISOString(),
  };
}

export async function getPublicServiceConfiguration(client = pool) {
  const settings = await getAdminServiceSettings(client);

  return {
    map: settings.map,
    geocoding: {
      searchEndpoint: "/api/v1/geocoding/search",
      reverseEndpoint: "/api/v1/geocoding/reverse",
    },
    overpass: {
      nearbyEndpoint: "/api/v1/geocoding/nearby",
      searchRadiusMeters: Number(settings.overpass.searchRadiusMeters || 2500),
      maxResults: Number(settings.overpass.maxResults || 50),
    },
    updatedAt: settings.updatedAt,
  };
}
