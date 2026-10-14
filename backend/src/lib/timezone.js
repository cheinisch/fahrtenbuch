import { badRequest } from "./errors.js";

/**
 * Time zone helpers. Trips store IANA zone ids (e.g. "Europe/Berlin"), never
 * fixed offsets, so daylight saving time is resolved per timestamp by Intl.
 */

export const DEFAULT_TIMEZONE = "Europe/Berlin";

export function isValidTimeZone(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads an optional IANA time zone from a request body.
 * Returns undefined when absent, null when explicitly null.
 */
export function timeZoneField(object, name) {
  const value = object?.[name];
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!isValidTimeZone(value)) {
    throw badRequest("VALIDATION_ERROR", `${name} must be a valid IANA time zone (e.g. Europe/Berlin).`);
  }
  // Normalize the spelling ("europe/berlin" -> "Europe/Berlin")
  return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
}

export function resolveTimeZone(...candidates) {
  return candidates.find((zone) => isValidTimeZone(zone)) || DEFAULT_TIMEZONE;
}

/** Formats a timestamp in the given zone (DST aware), e.g. "13.10.26, 16:12" for de-DE. */
export function formatInTimeZone(value, timeZone, locale = "de-DE", options = { dateStyle: "short", timeStyle: "short" }) {
  if (value === null || value === undefined) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: resolveTimeZone(timeZone) }).format(date);
}

/** Local wall-clock time in ISO-like form without offset, e.g. "2026-10-13T16:12:00". */
export function localIsoInTimeZone(value, timeZone) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: resolveTimeZone(timeZone),
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** UTC offset of the zone at that moment, e.g. "+02:00" in summer, "+01:00" in winter. */
export function offsetInTimeZone(value, timeZone) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    timeZoneName: "longOffset",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return match ? `${match[1]}:${match[2] || "00"}` : "+00:00";
}

/** Valid IANA zone of the user's account (falls back to DEFAULT_TIMEZONE). */
export async function userTimeZone(db, userId) {
  const result = await db.query("SELECT timezone FROM users WHERE id = $1", [userId]);
  return resolveTimeZone(result.rows[0]?.timezone);
}

/**
 * SQL expression for the local zone of a trip: the zone recorded at trip start,
 * else the account zone passed as a query parameter (e.g. "$2").
 * Use it for every day/month grouping or date bound so DST and travel are respected.
 */
export function tripZoneSql(alias, zoneParameter) {
  const prefix = alias ? `${alias}.` : "";
  return `COALESCE(${prefix}start_timezone, ${zoneParameter}::text)`;
}

/** Local timestamp (without zone) of a trip start, for date_trunc / ::date / to_char. */
export function tripLocalStartSql(alias, zoneParameter) {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}started_at AT TIME ZONE ${tripZoneSql(alias, zoneParameter)})`;
}
