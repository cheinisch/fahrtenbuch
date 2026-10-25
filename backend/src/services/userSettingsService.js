import { pool } from "../database/pool.js";
import { badRequest } from "../lib/errors.js";
import { isGravatarEnabled, isMailConfigured } from "./systemSettingsService.js";
import { getAdminServiceSettings, resolveMapMatching } from "./serviceSettingsService.js";

const DEFAULT_USER_SETTINGS = Object.freeze({
  automaticTrackingEnabled: false,
  trackingAccuracyMode: "balanced",
  stopDelaySeconds: 180,
  saveAccuracy: true,
  mapProvider: "osm",
  distanceUnit: "km",
  dateFormat: "EU",
  speedUnit: "kmh",
  timeFormat: "24h",
  mapStyle: "osm",
});

export const MAP_STYLES = ["osm", "light", "dark", "auto"];

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

/** Eigene Einstellung, sonst die frühere Vorabversion autoMapMatchingEnabled, sonst an. */
function mapMatchingSetting(customSettings) {
  if (typeof customSettings.mapMatchingEnabled === "boolean") return customSettings.mapMatchingEnabled;
  if (typeof customSettings.autoMapMatchingEnabled === "boolean") return customSettings.autoMapMatchingEnabled;
  return true;
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

    distanceUnit: ["km", "mi"].includes(customSettings.distanceUnit) ? customSettings.distanceUnit : DEFAULT_USER_SETTINGS.distanceUnit,
    dateFormat: ["EU", "US"].includes(customSettings.dateFormat) ? customSettings.dateFormat : DEFAULT_USER_SETTINGS.dateFormat,
    speedUnit: ["kmh", "mph"].includes(customSettings.speedUnit) ? customSettings.speedUnit : DEFAULT_USER_SETTINGS.speedUnit,
    timeFormat: ["12h", "24h"].includes(customSettings.timeFormat) ? customSettings.timeFormat : DEFAULT_USER_SETTINGS.timeFormat,
    // Kartenstil im Web: osm = Kartenvorgabe des Servers, light/dark = OpenFreeMap wie in der App,
    // auto = hell oder dunkel passend zum Farbschema
    mapStyle: MAP_STYLES.includes(customSettings.mapStyle) ? customSettings.mapStyle : DEFAULT_USER_SETTINGS.mapStyle,
    // Persönliche Wahl (Standard: an) und ob die Instanz Gravatar überhaupt erlaubt
    gravatarEnabled: customSettings.gravatarEnabled !== false,
    gravatarAvailable: isGravatarEnabled(),
    // Monatsbericht per E-Mail (Standard: an); nur wählbar, wenn SMTP eingerichtet ist
    monthlyReportEnabled: customSettings.monthlyReportEnabled !== false,
    monthlyReportAvailable: isMailConfigured(),
    // Map-Matching verwenden (Standard: an): Fahrten nach dem Upload matchen und
    // Straßenrouten in Web und App zeigen. Verfügbar nur, wenn ein Admin einen
    // Dienst eingerichtet hat – wird in withAvailability ergänzt.
    mapMatchingEnabled: mapMatchingSetting(customSettings),
    mapMatchingAvailable: false,

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

/** Ergänzt Angaben, die eine Datenbankabfrage brauchen (Admin-Dienste). */
async function withAvailability(settings, client = pool) {
  let available = false;
  try {
    available = resolveMapMatching(await getAdminServiceSettings(client)).enabled;
  } catch (error) {
    console.warn("Map-Matching-Verfügbarkeit nicht ermittelbar:", error.message);
  }
  return { ...settings, mapMatchingAvailable: available };
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

  return withAvailability(mapUserSettings(result.rows[0]), client);
}

export async function updateUserSettings(
  userId,
  body,
  client = pool,
) {
  const input = isObject(body) ? body : {};

  // Vorabversion des Feldes weiter annehmen, aber unter dem neuen Namen speichern
  if (input.mapMatchingEnabled === undefined && input.autoMapMatchingEnabled !== undefined) {
    input.mapMatchingEnabled = input.autoMapMatchingEnabled;
  }
  delete input.autoMapMatchingEnabled;

  if (input.mapMatchingEnabled !== undefined && typeof input.mapMatchingEnabled !== "boolean") {
    throw badRequest("VALIDATION_ERROR", "mapMatchingEnabled muss true oder false sein.");
  }

  if (input.mapStyle !== undefined && !MAP_STYLES.includes(input.mapStyle)) {
    throw badRequest("VALIDATION_ERROR", `mapStyle muss einer der Werte ${MAP_STYLES.join(", ")} sein.`);
  }

  const knownKeys = new Set([
    "automaticTrackingEnabled",
    "trackingAccuracyMode",
    "stopDelaySeconds",
    "saveAccuracy",
    "mapProvider",
    "customSettings",
    "createdAt",
    "updatedAt",
    // Nur zur Anzeige, nie speichern
    "gravatarAvailable",
    "monthlyReportAvailable",
    "mapMatchingAvailable",
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

  return withAvailability(mapUserSettings(result.rows[0]), client);
}
