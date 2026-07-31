import { pool } from "../database/pool.js";

export function mapUserSettings(row) {
  const customSettings = row?.settings || {};

  return {
    ...customSettings,
    automaticTrackingEnabled: Boolean(row?.automatic_tracking_enabled),
    trackingAccuracyMode: row?.tracking_accuracy_mode || "balanced",
    stopDelaySeconds: Number(row?.stop_delay_seconds ?? 180),
    saveAccuracy: row?.save_accuracy !== false,
    mapProvider: row?.map_provider || "osm",
    customSettings,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
  };
}

export async function getUserSettings(userId, client = pool) {
  await client.query(
    `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [userId],
  );

  const result = await client.query(
    `SELECT * FROM user_settings WHERE user_id = $1 LIMIT 1`,
    [userId],
  );

  return mapUserSettings(result.rows[0]);
}

export async function updateUserSettings(userId, body, client = pool) {
  const knownKeys = new Set([
    "automaticTrackingEnabled",
    "trackingAccuracyMode",
    "stopDelaySeconds",
    "saveAccuracy",
    "mapProvider",
    "customSettings",
    "createdAt",
    "updatedAt",
  ]);

  const customInput = {
    ...(body.customSettings && typeof body.customSettings === "object"
      ? body.customSettings
      : {}),
  };

  for (const [key, value] of Object.entries(body)) {
    if (!knownKeys.has(key)) {
      customInput[key] = value;
    }
  }

  const result = await client.query(
    `
      INSERT INTO user_settings (
        user_id,
        automatic_tracking_enabled,
        tracking_accuracy_mode,
        stop_delay_seconds,
        save_accuracy,
        map_provider,
        settings
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (user_id)
      DO UPDATE SET
        automatic_tracking_enabled =
          COALESCE($2, user_settings.automatic_tracking_enabled),
        tracking_accuracy_mode =
          COALESCE($3, user_settings.tracking_accuracy_mode),
        stop_delay_seconds =
          COALESCE($4, user_settings.stop_delay_seconds),
        save_accuracy =
          COALESCE($5, user_settings.save_accuracy),
        map_provider =
          COALESCE($6, user_settings.map_provider),
        settings =
          COALESCE(user_settings.settings, '{}'::jsonb)
          || COALESCE($7::jsonb, '{}'::jsonb)
      RETURNING *
    `,
    [
      userId,
      body.automaticTrackingEnabled ?? null,
      body.trackingAccuracyMode ?? null,
      body.stopDelaySeconds ?? null,
      body.saveAccuracy ?? null,
      body.mapProvider ?? null,
      JSON.stringify(customInput),
    ],
  );

  return mapUserSettings(result.rows[0]);
}
