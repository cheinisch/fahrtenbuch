import { pool } from "../database/pool.js";
import { badRequest, notFound } from "../lib/errors.js";
import { haversineDistance } from "../lib/geo.js";
import { mapTrip } from "../lib/mappers.js";
import { enqueueJob } from "../jobs/queue.js";
import { queueAutoMapMatching } from "./mapMatchingService.js";
import { appendTripHistory, getOwnedTrip, recalculateTripMetrics } from "./tripService.js";

export const MAX_EDITOR_POINTS = 20_000;
// Ab dieser Verschiebung wird eine unveränderte Start-/Zieladresse neu ermittelt
const ADDRESS_MOVE_METERS = 150;

function optionalNumber(value, minimum, maximum) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

/** Punkte aus dem Editor prüfen; Messwerte (Genauigkeit usw.) nur übernehmen, wenn gültig. */
export function normalizeEditorPoints(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > MAX_EDITOR_POINTS) {
    throw badRequest("VALIDATION_ERROR", `Die Route muss 2 bis ${MAX_EDITOR_POINTS} Punkte enthalten.`);
  }
  return input.map((point, index) => {
    const lat = Number(point?.lat ?? point?.latitude);
    const lon = Number(point?.lon ?? point?.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw badRequest("VALIDATION_ERROR", `Punkt ${index + 1} ist ungültig.`);
    }
    let recordedAt = null;
    if (point?.recordedAt) {
      const date = new Date(point.recordedAt);
      if (!Number.isFinite(date.getTime())) throw badRequest("VALIDATION_ERROR", `Die Zeit von Punkt ${index + 1} ist ungültig.`);
      recordedAt = date;
    }
    const bearing = optionalNumber(point?.bearing, 0, 359.999999);
    return {
      lat,
      lon,
      recordedAt,
      altitude: optionalNumber(point?.altitude, -1000, 10_000),
      accuracy: optionalNumber(point?.accuracy, 0, 100_000),
      speed: optionalNumber(point?.speed, 0, 1000),
      bearing,
    };
  });
}

/**
 * Zeitstempel für alle Punkte: erster Punkt = Start, letzter = Ende. Punkte ohne Zeit
 * (neu gesetzt oder über die Straße ergänzt) werden nach Strecke zwischen den nächsten
 * Punkten mit Zeit verteilt. Ergebnis ist aufsteigend und liegt zwischen Start und Ende.
 */
export function assignPointTimes(points, startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const times = points.map((point) => (point.recordedAt ? new Date(point.recordedAt).getTime() : null));
  times[0] = start;
  times[times.length - 1] = end;
  // Vorhandene Zeiten in den Rahmen bringen und gegen Rücksprünge absichern
  for (let i = 1; i < times.length - 1; i++) {
    if (times[i] == null) continue;
    times[i] = Math.min(Math.max(times[i], start), end);
  }

  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + haversineDistance(points[i - 1], points[i]));

  let anchor = 0;
  for (let i = 1; i < times.length; i++) {
    if (times[i] == null) continue;
    // Lücke anchor..i auffüllen
    const span = cumulative[i] - cumulative[anchor];
    for (let j = anchor + 1; j < i; j++) {
      const ratio = span > 0 ? (cumulative[j] - cumulative[anchor]) / span : (j - anchor) / (i - anchor);
      times[j] = times[anchor] + (times[i] - times[anchor]) * ratio;
    }
    anchor = i;
  }
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1]) times[i] = times[i - 1];
  }
  return times.map((time) => new Date(Math.round(time)));
}

function addressInput(body, name) {
  if (!(name in body)) return undefined;
  const value = body[name];
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 1000) {
    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ ist ungültig.`);
  }
  return value.trim() || null;
}

/**
 * Fahrt aus dem Editor speichern: Punkte ersetzen, Start/Ende und Adressen setzen,
 * Distanz und Dauer neu berechnen. Abgeschlossene Zeiträume schützt der DB-Trigger.
 */
export async function saveTripRoute(userId, tripId, body) {
  const input = body && typeof body === "object" ? body : {};
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime())) {
    throw badRequest("VALIDATION_ERROR", "Start- und Endzeit sind erforderlich.");
  }
  if (endedAt <= startedAt) throw badRequest("VALIDATION_ERROR", "Das Ende muss nach dem Start liegen.");
  const points = normalizeEditorPoints(input.points);
  const times = assignPointTimes(points, startedAt, endedAt);
  const startAddress = addressInput(input, "startAddress");
  const endAddress = addressInput(input, "endAddress");
  const routedCount = Number.isInteger(input.routedPointCount) ? input.routedPointCount : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const trip = await getOwnedTrip(client, userId, tripId, { includeTags: false });
    if (!trip) throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
    if (trip.status !== "completed") {
      throw badRequest("TRIP_NOT_COMPLETED", "Nur abgeschlossene Fahrten können bearbeitet werden.");
    }
    await client.query(`SELECT id FROM trips WHERE id = $1 FOR UPDATE`, [tripId]);
    const previous = await client.query(`SELECT count(*)::int AS count FROM track_points WHERE trip_id = $1`, [tripId]);

    await client.query(`DELETE FROM track_points WHERE trip_id = $1`, [tripId]);
    await client.query(
      `INSERT INTO track_points (trip_id, sequence_number, lat, lon, altitude_meters, accuracy_meters, speed_mps, bearing_degrees, recorded_at)
       SELECT $1, n - 1, lat, lon, alt, acc, spd, brg, ts
       FROM unnest($2::double precision[], $3::double precision[], $4::double precision[], $5::double precision[],
                   $6::double precision[], $7::double precision[], $8::timestamptz[])
         WITH ORDINALITY AS p(lat, lon, alt, acc, spd, brg, ts, n)`,
      [
        tripId,
        points.map((point) => point.lat),
        points.map((point) => point.lon),
        points.map((point) => point.altitude),
        points.map((point) => point.accuracy),
        points.map((point) => point.speed),
        points.map((point) => point.bearing),
        times,
      ],
    );

    await client.query(
      `UPDATE trips SET started_at = $2, ended_at = $3,
         start_address = CASE WHEN $4 THEN $5 ELSE start_address END,
         end_address = CASE WHEN $6 THEN $7 ELSE end_address END
       WHERE id = $1`,
      [tripId, startedAt, endedAt, startAddress !== undefined, startAddress ?? null, endAddress !== undefined, endAddress ?? null],
    );
    await recalculateTripMetrics(client, tripId);

    // Unveränderte Adresse zu einem deutlich verschobenen Endpunkt neu ermitteln lassen
    const moved = (lat, lon, point) =>
      lat == null || lon == null || haversineDistance({ lat: Number(lat), lon: Number(lon) }, point) > ADDRESS_MOVE_METERS;
    const unchanged = (value, current) => value === undefined || (value ?? null) === (current ?? null);
    const resetStart = unchanged(startAddress, trip.start_address) && moved(trip.start_lat, trip.start_lon, points[0]);
    const resetEnd = unchanged(endAddress, trip.end_address) && moved(trip.end_lat, trip.end_lon, points.at(-1));
    if (resetStart || resetEnd) {
      await client.query(
        `UPDATE trips SET
           start_address = CASE WHEN $2 THEN NULL ELSE start_address END,
           end_address = CASE WHEN $3 THEN NULL ELSE end_address END
         WHERE id = $1`,
        [tripId, resetStart, resetEnd],
      );
    }

    const updated = await getOwnedTrip(client, userId, tripId);
    const meters = (value) => (value == null ? null : Number(value));
    await appendTripHistory(client, {
      tripId,
      userId,
      eventType: "ROUTE_CORRECTED",
      changedFields: { distanceMeters: true },
      oldValues: { distanceMeters: meters(trip.distance_meters) },
      newValues: { distanceMeters: meters(updated.distance_meters) },
      metadata: {
        method: "editor",
        pointCount: points.length,
        previousCount: previous.rows[0].count,
        ...(routedCount != null ? { routedPointCount: routedCount } : {}),
      },
    });
    await client.query("COMMIT");

    if (resetStart || resetEnd) {
      await enqueueJob("trip.reverseGeocode", { tripId, userId }).catch((error) =>
        console.warn("Trip geocoding enqueue failed:", error.message));
    }
    await queueAutoMapMatching(userId, [tripId]);
    return mapTrip(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
