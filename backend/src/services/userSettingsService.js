import { pool } from "../database/pool.js";

const DEFAULT_USER_SETTINGS = Object.freeze({
  automaticTrackingEnabled: false,
  trackingAccuracyMode: "balanced",
  stopDelaySeconds: 180,
  saveAccuracy: true,
  mapProvider: "osm",
});

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

export function mapUserSettings(row) {
  const customSettings = isObject(row?.settings)
    ? row.settings
    : {};

  return {
    ...customSettings,

    automaticTrackingEnabled:
      row?.automatic_tracking_enabled ??
      DEFAULT_USER_SETTINGS
        .automaticTrackingEnabled,

    trackingAccuracyMode:
      row?.tracking_accuracy_mode ||
      DEFAULT_USER_SETTINGS
        .trackingAccuracyMode,

    stopDelaySeconds: Number(
      row?.stop_delay_seconds ??
        DEFAULT_USER_SETTINGS
          .stopDelaySeconds,
    ),

    saveAccuracy:
      row?.save_accuracy ??
      DEFAULT_USER_SETTINGS.saveAccuracy,

    mapProvider:
      row?.map_provider ||
      DEFAULT_USER_SETTINGS.mapProvider,

    customSettings,

    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
  };
}

export async function ensureUserSettings(
  userId,
  client = pool,
) {
  await client.query(
    `
      INSERT INTO user_settings (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );
}

export async function getUserSettings(
  userId,
  client = pool,
) {
  await ensureUserSettings(userId, client);

  const result = await client.query(
    `
      SELECT *
      FROM user_settings
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return mapUserSettings(result.rows[0]);
}

export async function updateUserSettings(
  userId,
  body,
  client = pool,
) {
  const input = isObject(body) ? body : {};

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

  const customInput = isObject(
    input.customSettings,
  )
    ? { ...input.customSettings }
    : {};

  /*
   * Noch nicht als eigene Datenbankspalte definierte
   * Einstellungen werden in user_settings.settings
   * gespeichert. Dazu gehört beispielsweise homeLocation.
   */
  for (const [key, value] of Object.entries(
    input,
  )) {
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
      VALUES (
        $1,
        COALESCE($2::boolean, false),
        COALESCE($3::text, 'balanced'),
        COALESCE($4::integer, 180),
        COALESCE($5::boolean, true),
        COALESCE($6::text, 'osm'),
        COALESCE($7::jsonb, '{}'::jsonb)
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        automatic_tracking_enabled =
          COALESCE(
            $2::boolean,
            user_settings
              .automatic_tracking_enabled
          ),

        tracking_accuracy_mode =
          COALESCE(
            $3::text,
            user_settings
              .tracking_accuracy_mode
          ),

        stop_delay_seconds =
          COALESCE(
            $4::integer,
            user_settings
              .stop_delay_seconds
          ),

        save_accuracy =
          COALESCE(
            $5::boolean,
            user_settings.save_accuracy
          ),

        map_provider =
          COALESCE(
            $6::text,
            user_settings.map_provider
          ),

        settings =
          COALESCE(
            user_settings.settings,
            '{}'::jsonb
          )
          ||
          COALESCE(
            $7::jsonb,
            '{}'::jsonb
          )

      RETURNING *
    `,
    [
      userId,

      input.automaticTrackingEnabled ??
        null,

      input.trackingAccuracyMode ??
        null,

      input.stopDelaySeconds ??
        null,

      input.saveAccuracy ??
        null,

      input.mapProvider ??
        null,

      JSON.stringify(customInput),
    ],
  );

  return mapUserSettings(result.rows[0]);
}
