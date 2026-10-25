import { pool } from "../database/pool.js";
import { badRequest, notFound, serviceUnavailable } from "../lib/errors.js";
import { haversineDistance } from "../lib/geo.js";
import { mapTrip } from "../lib/mappers.js";
import { decryptSecret, encryptSecret } from "../security/encryption.js";
import { enqueueJob } from "../jobs/queue.js";
import { queueAutoMapMatching } from "./mapMatchingService.js";
import { appendTripHistory, getOwnedTrip, recalculateTripMetrics } from "./tripService.js";

const TIMEOUT_MS = 15_000;
const PER_PAGE = 2_000;
const MAX_PAGES = 25;
// Lücken unter dieser Dauer sind normales Aufzeichnungsintervall, keine Ausfälle
export const MIN_GAP_SECONDS = 60;
// Ungenauere Dawarich-Punkte (Funkzelle, WLAN) verfälschen die Strecke mehr als sie helfen
export const MAX_ACCURACY_METERS = 200;
// Ab dieser Verschiebung wird die automatisch ermittelte Start-/Zieladresse neu bestimmt
const ADDRESS_MOVE_METERS = 150;

/** Basis-URL säubern: Schema prüfen, Schrägstriche und einen angehängten /api/v1-Pfad entfernen. */
export function normalizeBaseUrl(input) {
  const raw = String(input ?? "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("VALIDATION_ERROR", "Die Dawarich-Adresse ist keine gültige URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw badRequest("VALIDATION_ERROR", "Die Dawarich-Adresse muss mit http:// oder https:// beginnen.");
  }
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/i, "");
  return `${url.origin}${path}`;
}

async function dawarichRequest(baseUrl, apiKey, path, params = {}) {
  const url = new URL(`${baseUrl}/api/v1/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "Fahrtenbuch/1.0",
      },
      signal: controller.signal,
    });
    if (response.status === 401) {
      throw badRequest("DAWARICH_UNAUTHORIZED", "Dawarich hat den API-Key abgelehnt.");
    }
    if (!response.ok) {
      throw serviceUnavailable("DAWARICH_ERROR", `Dawarich antwortete mit HTTP ${response.status}.`);
    }
    return {
      data: await response.json(),
      headers: response.headers,
    };
  } catch (error) {
    if (error.status) throw error;
    const reason = error.name === "AbortError" ? "Zeitüberschreitung" : (error.cause?.code || error.message);
    throw serviceUnavailable("DAWARICH_UNREACHABLE", `Dawarich ist nicht erreichbar (${reason}).`);
  } finally {
    clearTimeout(timeout);
  }
}

/** Zugangsdaten prüfen; liefert Konto und Version der Dawarich-Instanz. */
export async function verifyDawarich(baseUrl, apiKey) {
  const { data, headers } = await dawarichRequest(baseUrl, apiKey, "users/me");
  return {
    email: data?.user?.email || null,
    version: headers.get("x-dawarich-version") || null,
  };
}

function mapConnection(row) {
  if (!row) return { connected: false };
  return {
    connected: true,
    baseUrl: row.base_url,
    apiKeyHint: row.api_key_hint,
    email: row.dawarich_email,
    version: row.dawarich_version,
    verifiedAt: row.verified_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

async function connectionRow(userId, client = pool) {
  const result = await client.query(`SELECT * FROM user_dawarich_connections WHERE user_id = $1`, [userId]);
  return result.rows[0] || null;
}

export async function getDawarichConnection(userId) {
  return mapConnection(await connectionRow(userId));
}

/**
 * Verbindung speichern. Wird kein neuer API-Key mitgeschickt, bleibt der gespeicherte
 * (z. B. wenn nur die Adresse geändert wird). Gespeichert wird nur nach erfolgreichem Test.
 */
export async function saveDawarichConnection(userId, { baseUrl, apiKey }) {
  const url = normalizeBaseUrl(baseUrl);
  let key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    const existing = await connectionRow(userId);
    if (!existing) throw badRequest("VALIDATION_ERROR", "Bitte einen API-Key angeben.");
    key = decryptSecret(existing.api_key_encrypted);
  }
  if (key.length > 500) throw badRequest("VALIDATION_ERROR", "Der API-Key ist zu lang.");

  const info = await verifyDawarich(url, key);
  const result = await pool.query(
    `INSERT INTO user_dawarich_connections
       (user_id, base_url, api_key_encrypted, api_key_hint, dawarich_email, dawarich_version, verified_at, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, now(), NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       api_key_encrypted = EXCLUDED.api_key_encrypted,
       api_key_hint = EXCLUDED.api_key_hint,
       dawarich_email = EXCLUDED.dawarich_email,
       dawarich_version = EXCLUDED.dawarich_version,
       verified_at = now(),
       last_error = NULL,
       updated_at = now()
     RETURNING *`,
    [userId, url, encryptSecret(key), key.slice(-4), info.email, info.version],
  );
  return mapConnection(result.rows[0]);
}

export async function deleteDawarichConnection(userId) {
  await pool.query(`DELETE FROM user_dawarich_connections WHERE user_id = $1`, [userId]);
}

/** Gespeicherte Verbindung erneut prüfen und das Ergebnis vermerken. */
export async function testDawarichConnection(userId) {
  const row = await connectionRow(userId);
  if (!row) throw notFound("DAWARICH_NOT_CONNECTED", "Es ist keine Dawarich-Verbindung eingerichtet.");
  try {
    const info = await verifyDawarich(row.base_url, decryptSecret(row.api_key_encrypted));
    const result = await pool.query(
      `UPDATE user_dawarich_connections
       SET dawarich_email = $2, dawarich_version = $3, verified_at = now(), last_error = NULL, updated_at = now()
       WHERE user_id = $1 RETURNING *`,
      [userId, info.email, info.version],
    );
    return mapConnection(result.rows[0]);
  } catch (error) {
    await pool.query(
      `UPDATE user_dawarich_connections SET last_error = $2, updated_at = now() WHERE user_id = $1`,
      [userId, error.message],
    );
    throw error;
  }
}

/** Dawarich-Punkt → Fahrtenbuch-Punkt; null bei unbrauchbaren Werten. */
export function normalizeDawarichPoint(point) {
  const lat = Number(point?.latitude);
  const lon = Number(point?.longitude);
  const timestamp = Number(point?.timestamp);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const number = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
  const accuracy = number(point.accuracy);
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_METERS) return null;
  const altitude = number(point.altitude);
  const course = number(point.course);
  return {
    lat,
    lon,
    recordedAt: new Date(timestamp * 1000),
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    altitude: Number.isFinite(altitude) ? altitude : null,
    // Geschwindigkeit nicht übernehmen: Dawarich speichert sie je nach Quelle in km/h oder m/s
    bearing: Number.isFinite(course) && course >= 0 && course < 360 ? course : null,
  };
}

/**
 * Zeiträume ohne eigene Punkte: Fahrtbeginn → erster Punkt, Abstände zwischen Punkten,
 * letzter Punkt → Fahrtende – jeweils nur ab MIN_GAP_SECONDS.
 */
export function findGaps(startedAt, endedAt, existingTimes, minGapSeconds = MIN_GAP_SECONDS) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const times = existingTimes.map((value) => new Date(value).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const bounds = [start, ...times.filter((time) => time > start && time < end), end];
  const gaps = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1] - bounds[i] >= minGapSeconds * 1000) gaps.push({ from: bounds[i], to: bounds[i + 1] });
  }
  return gaps;
}

async function fetchDawarichPoints(baseUrl, apiKey, from, to) {
  const points = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, headers } = await dawarichRequest(baseUrl, apiKey, "points", {
      start_at: Math.floor(from / 1000),
      end_at: Math.ceil(to / 1000),
      order: "asc",
      per_page: PER_PAGE,
      page,
    });
    if (!Array.isArray(data)) {
      throw serviceUnavailable("DAWARICH_ERROR", "Dawarich lieferte eine unerwartete Antwort.");
    }
    points.push(...data);
    const totalPages = Number(headers.get("x-total-pages"));
    if (data.length < PER_PAGE || (Number.isFinite(totalPages) && page >= totalPages)) break;
  }
  return points;
}

/**
 * Lücken einer abgeschlossenen Fahrt mit Punkten aus Dawarich füllen. Vorhandene Punkte
 * bleiben erhalten; Distanz und Dauer werden neu berechnet, Map-Matching neu eingereiht.
 */
export async function importTripPointsFromDawarich(userId, tripId) {
  const row = await connectionRow(userId);
  if (!row) throw notFound("DAWARICH_NOT_CONNECTED", "Es ist keine Dawarich-Verbindung eingerichtet.");

  const trip = await getOwnedTrip(pool, userId, tripId, { includeTags: false });
  if (!trip) throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
  if (trip.status !== "completed" || !trip.ended_at) {
    throw badRequest("TRIP_NOT_COMPLETED", "Nur abgeschlossene Fahrten können ergänzt werden.");
  }

  const existing = await pool.query(`SELECT recorded_at FROM track_points WHERE trip_id = $1`, [tripId]);
  const gaps = findGaps(trip.started_at, trip.ended_at, existing.rows.map((point) => point.recorded_at));
  if (!gaps.length) return { importedCount: 0, gapCount: 0, trip: mapTrip(await getOwnedTrip(pool, userId, tripId)) };

  const apiKey = decryptSecret(row.api_key_encrypted);
  const start = new Date(trip.started_at).getTime();
  const end = new Date(trip.ended_at).getTime();
  const raw = await fetchDawarichPoints(row.base_url, apiKey, start, end);
  const seen = new Set();
  const candidates = raw
    .map(normalizeDawarichPoint)
    .filter(Boolean)
    .filter((point) => {
      const time = point.recordedAt.getTime();
      // innerhalb einer Lücke, nicht auf deren Grenzpunkten, keine Zeitstempel doppelt
      if (!gaps.some((gap) => time > gap.from && time < gap.to) || seen.has(time)) return false;
      seen.add(time);
      return true;
    });

  if (!candidates.length) return { importedCount: 0, gapCount: gaps.length, trip: mapTrip(await getOwnedTrip(pool, userId, tripId)) };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Sperrt die Fahrt gegen parallele Korrekturen
    const locked = await client.query(`SELECT id FROM trips WHERE id = $1 AND user_id = $2 FOR UPDATE`, [tripId, userId]);
    if (!locked.rowCount) throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");

    // Neue Punkte zunächst mit Platzhalter-Nummern einfügen, danach alle nach Zeit neu nummerieren
    const offset = 4_000_000_000_000;
    for (let i = 0; i < candidates.length; i++) {
      const point = candidates[i];
      await client.query(
        `INSERT INTO track_points (trip_id, sequence_number, lat, lon, altitude_meters, accuracy_meters, bearing_degrees, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tripId, offset + i, point.lat, point.lon, point.altitude, point.accuracy, point.bearing, point.recordedAt],
      );
    }
    // Zwei Schritte, weil (trip_id, sequence_number) eindeutig ist und sofort geprüft wird
    await client.query(
      `UPDATE track_points tp SET sequence_number = r.rn + $2
       FROM (SELECT id, row_number() OVER (ORDER BY recorded_at, sequence_number, id) AS rn
             FROM track_points WHERE trip_id = $1) r
       WHERE tp.id = r.id`,
      [tripId, offset * 2],
    );
    await client.query(
      `UPDATE track_points SET sequence_number = sequence_number - $2 - 1 WHERE trip_id = $1`,
      [tripId, offset * 2],
    );

    await recalculateTripMetrics(client, tripId);
    const updatedRow = (await client.query(`SELECT start_lat, start_lon, end_lat, end_lon FROM trips WHERE id = $1`, [tripId])).rows[0];
    // Automatisch ermittelte Adressen passten zu den alten Endpunkten; bei deutlicher
    // Verschiebung neu bestimmen lassen
    const moved = (oldLat, oldLon, newLat, newLon) =>
      oldLat == null || oldLon == null ||
      haversineDistance({ lat: Number(oldLat), lon: Number(oldLon) }, { lat: Number(newLat), lon: Number(newLon) }) > ADDRESS_MOVE_METERS;
    const resetStart = updatedRow && moved(trip.start_lat, trip.start_lon, updatedRow.start_lat, updatedRow.start_lon);
    const resetEnd = updatedRow && moved(trip.end_lat, trip.end_lon, updatedRow.end_lat, updatedRow.end_lon);
    if (resetStart || resetEnd) {
      await client.query(
        `UPDATE trips SET
           start_address = CASE WHEN $2 THEN NULL ELSE start_address END,
           end_address = CASE WHEN $3 THEN NULL ELSE end_address END
         WHERE id = $1`,
        [tripId, Boolean(resetStart), Boolean(resetEnd)],
      );
    }

    const updated = await getOwnedTrip(client, userId, tripId);
    const meters = (value) => (value == null ? null : Number(value));
    await appendTripHistory(client, {
      tripId,
      userId,
      eventType: "POINTS_IMPORTED",
      changedFields: { distanceMeters: true },
      oldValues: { distanceMeters: meters(trip.distance_meters) },
      newValues: { distanceMeters: meters(updated.distance_meters) },
      metadata: {
        source: "dawarich",
        importedCount: candidates.length,
        gapCount: gaps.length,
        previousCount: existing.rowCount,
      },
    });
    await client.query("COMMIT");

    if (resetStart || resetEnd) {
      await enqueueJob("trip.reverseGeocode", { tripId, userId }).catch((error) =>
        console.warn("Trip geocoding enqueue failed:", error.message));
    }
    await queueAutoMapMatching(userId, [tripId]);
    return { importedCount: candidates.length, gapCount: gaps.length, trip: mapTrip(updated) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
