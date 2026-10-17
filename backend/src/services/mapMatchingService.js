import { pool } from "../database/pool.js";
import { routeDistance } from "../lib/geo.js";
import {
  getAdminServiceSettings,
  resolveMapMatching,
} from "./serviceSettingsService.js";
import { appendTripHistory } from "./tripService.js";

// Atlas nimmt bis 10 000 Punkte; Valhallas Standardlimit (max_shape) liegt darüber.
const MAX_POINTS = { atlas: 10_000, valhalla: 10_000, osrm: 100 };

// Plausibilitätsgrenzen: Map-Matching schließt Lücken entlang der Straße, die
// Distanz wird also meist etwas länger. Deutlich kürzer oder vielfach länger
// spricht für ein Fehlmatching – dann bleibt die bisherige Distanz.
const MIN_RATIO = 0.8;
const MAX_RATIO = 2.5;
const MIN_CONFIDENCE = 0.5;

/** Fehler, bei dem ein erneuter Versuch nichts ändert (Spur nicht matchbar). */
class PermanentMatchError extends Error {}

export function decodePolyline6(encoded) {
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    coordinates.push([lat / 1e6, lon / 1e6]);
  }

  return coordinates;
}

/** Gleichmäßig ausdünnen, erster und letzter Punkt bleiben erhalten. */
export function samplePoints(points, maximum) {
  if (points.length <= maximum) return points;
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, i) => points[Math.round(i * step)]);
}

async function postJson(url, body, timeoutMs, method = "POST") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "User-Agent": "Fahrtenbuch/1.0",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);

    // 4xx außer 429: die Spur selbst ist das Problem → nicht wiederholen
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      const detail = data?.error?.message || data?.error || data?.message || `HTTP ${response.status}`;
      throw new PermanentMatchError(`Die Spur konnte nicht gematcht werden: ${detail}`);
    }

    if (!response.ok) {
      throw new Error(`Der Routing-Dienst antwortete mit HTTP ${response.status}.`);
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Der Routing-Dienst hat nicht rechtzeitig geantwortet.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function legsToRoute(legs = []) {
  const route = [];
  for (const leg of legs) {
    const shape = typeof leg?.shape === "string" ? decodePolyline6(leg.shape) : [];
    // Anschlusspunkt zwischen zwei Legs nicht doppelt übernehmen
    route.push(...(route.length ? shape.slice(1) : shape));
  }
  return route;
}

async function matchWithAtlas(matching, points) {
  const data = await postJson(matching.url, {
    shape: points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      time: Math.round(p.time / 1000),
      ...(p.accuracy ? { accuracy: p.accuracy } : {}),
    })),
    mode: "auto",
    shape_match: "map_snap",
    format: "polyline6",
    breakage_distance: 5000,
  }, matching.timeoutMs);
  const result = data?.data || {};

  return {
    // Valhalla-Einheit: Kilometer
    distanceMeters: Math.round(Number(result.summary?.length) * 1000),
    route: legsToRoute(result.legs),
    confidence: Number.isFinite(Number(result.stats?.confidence_score))
      ? Number(result.stats.confidence_score)
      : null,
  };
}

async function matchWithValhalla(matching, points) {
  const data = await postJson(`${matching.url}/trace_route`, {
    shape: points.map((p) => ({ lat: p.lat, lon: p.lon, time: Math.round(p.time / 1000) })),
    costing: "auto",
    shape_match: "map_snap",
    units: "kilometers",
    use_timestamps: true,
    // Größere Lücken (wenige GPS-Punkte) trotzdem als eine Fahrt routen
    trace_options: { search_radius: 50, breakage_distance: 5000 },
  }, matching.timeoutMs);
  const trip = data?.trip || {};

  return {
    distanceMeters: Math.round(Number(trip.summary?.length) * 1000),
    route: legsToRoute(trip.legs),
    confidence: null,
  };
}

async function matchWithOsrm(matching, points) {
  const coordinates = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = new URL(`${matching.url}/match/v1/driving/${coordinates}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("gaps", "ignore");
  url.searchParams.set("tidy", "true");
  url.searchParams.set("timestamps", points.map((p) => Math.round(p.time / 1000)).join(";"));
  url.searchParams.set("radiuses", points.map(() => 50).join(";"));

  const data = await postJson(url, null, matching.timeoutMs, "GET");

  if (data?.code !== "Ok" || !Array.isArray(data.matchings) || !data.matchings.length) {
    throw new PermanentMatchError(`Die Spur konnte nicht gematcht werden: ${data?.message || data?.code || "keine Zuordnung"}`);
  }

  return {
    distanceMeters: Math.round(data.matchings.reduce((sum, m) => sum + Number(m.distance || 0), 0)),
    route: data.matchings.flatMap((m) => (m.geometry?.coordinates || []).map(([lon, lat]) => [lat, lon])),
    confidence: Math.min(...data.matchings.map((m) => Number(m.confidence ?? 1))),
  };
}

const MATCHERS = { atlas: matchWithAtlas, valhalla: matchWithValhalla, osrm: matchWithOsrm };

async function saveResult(client, tripId, userId, provider, values) {
  await client.query(
    `INSERT INTO trip_map_matches (
       trip_id, user_id, status, provider, message, point_count,
       raw_distance_meters, matched_distance_meters, confidence, route, matched_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb, now())
     ON CONFLICT (trip_id) DO UPDATE SET
       status = EXCLUDED.status, provider = EXCLUDED.provider, message = EXCLUDED.message,
       point_count = EXCLUDED.point_count, raw_distance_meters = EXCLUDED.raw_distance_meters,
       matched_distance_meters = EXCLUDED.matched_distance_meters,
       confidence = EXCLUDED.confidence, route = EXCLUDED.route, matched_at = now()`,
    [
      tripId,
      userId,
      values.status,
      provider,
      values.message ?? null,
      values.pointCount ?? 0,
      values.rawDistanceMeters ?? null,
      values.matchedDistanceMeters ?? null,
      values.confidence ?? null,
      values.route ? JSON.stringify(values.route) : null,
    ],
  );
}

/**
 * Eine Fahrt auf das Straßennetz legen. Wird vom Worker aufgerufen.
 * Netzwerk-/Serverfehler werden geworfen (Worker wiederholt), eine nicht
 * matchbare Spur wird als „failed“ gespeichert.
 */
export async function matchTrip(tripId, userId) {
  const matching = resolveMapMatching(await getAdminServiceSettings());

  if (!matching.enabled) {
    console.info("Map-Matching übersprungen:", matching.reason);
    return { status: "skipped" };
  }

  const trip = await pool.query(
    `SELECT t.id, t.distance_meters FROM trips t
     WHERE t.id = $1 AND t.user_id = $2 AND t.status = 'completed' AND t.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM trip_period_locks l
         WHERE l.user_id = t.user_id AND t.started_at::date BETWEEN l.period_start AND l.period_end
       )`,
    [tripId, userId],
  );
  if (!trip.rowCount) return { status: "skipped" };

  const pointsResult = await pool.query(
    `SELECT lat, lon, accuracy_meters, recorded_at FROM track_points
     WHERE trip_id = $1 ORDER BY sequence_number, recorded_at, id`,
    [tripId],
  );
  const points = pointsResult.rows
    .map((row) => ({
      lat: Number(row.lat),
      lon: Number(row.lon),
      accuracy: row.accuracy_meters == null ? null : Number(row.accuracy_meters),
      time: new Date(row.recorded_at).getTime(),
    }))
    // Stillstand (identische Punkte) bringt dem Matching nichts
    .filter((p, i, all) => i === 0 || p.lat !== all[i - 1].lat || p.lon !== all[i - 1].lon);

  if (points.length < 2) return { status: "skipped" };

  const rawDistanceMeters = routeDistance(points);
  const sampled = samplePoints(points, MAX_POINTS[matching.provider]);
  const base = { pointCount: points.length, rawDistanceMeters };

  let result;
  try {
    result = await MATCHERS[matching.provider](matching, sampled);
  } catch (error) {
    if (!(error instanceof PermanentMatchError)) throw error;
    await saveResult(pool, tripId, userId, matching.provider, { ...base, status: "failed", message: error.message });
    return { status: "failed" };
  }

  const ratio = rawDistanceMeters > 0 ? result.distanceMeters / rawDistanceMeters : 1;
  let rejection = null;
  if (!Number.isFinite(result.distanceMeters) || result.distanceMeters <= 0 || result.route.length < 2) {
    rejection = "Der Dienst hat keine Route geliefert.";
  } else if (result.confidence !== null && result.confidence < MIN_CONFIDENCE) {
    rejection = `Zuordnung zu unsicher (Konfidenz ${result.confidence.toFixed(2)}).`;
  } else if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
    rejection = `Gematchte Distanz weicht zu stark ab (${(ratio * 100).toFixed(0)} % der GPS-Distanz).`;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await saveResult(client, tripId, userId, matching.provider, {
      ...base,
      status: rejection ? "rejected" : "applied",
      message: rejection,
      matchedDistanceMeters: Number.isFinite(result.distanceMeters) ? result.distanceMeters : null,
      confidence: result.confidence,
      route: result.route,
    });

    const oldDistance = trip.rows[0].distance_meters == null ? null : Number(trip.rows[0].distance_meters);
    if (!rejection && oldDistance !== result.distanceMeters) {
      await client.query(`UPDATE trips SET distance_meters = $2 WHERE id = $1`, [tripId, result.distanceMeters]);
      await appendTripHistory(client, {
        tripId,
        userId,
        eventType: "MAP_MATCHED",
        changedFields: { distance_meters: { old: oldDistance, new: result.distanceMeters } },
        oldValues: { distance_meters: oldDistance },
        newValues: { distance_meters: result.distanceMeters },
        metadata: {
          provider: matching.provider,
          pointCount: points.length,
          sentPointCount: sampled.length,
          rawDistanceMeters,
          confidence: result.confidence,
        },
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { status: rejection ? "rejected" : "applied" };
}

/** Fahrten für den manuellen Lauf auswählen. mode: missing | failed | all */
export async function selectTripsForMatching(mode, limit) {
  const result = await pool.query(
    `SELECT t.id, t.user_id FROM trips t
     LEFT JOIN trip_map_matches m ON m.trip_id = t.id
     WHERE t.status = 'completed' AND t.archived_at IS NULL
       AND (SELECT count(*) FROM (SELECT 1 FROM track_points p WHERE p.trip_id = t.id LIMIT 2) c) = 2
       AND NOT EXISTS (
         SELECT 1 FROM trip_period_locks l
         WHERE l.user_id = t.user_id AND t.started_at::date BETWEEN l.period_start AND l.period_end
       )
       AND (
         $1::text = 'all'
         OR ($1::text = 'missing' AND m.trip_id IS NULL)
         OR ($1::text = 'failed' AND m.status IN ('failed', 'rejected'))
       )
     ORDER BY t.started_at DESC
     LIMIT $2`,
    [mode, limit],
  );
  return result.rows;
}

/** Übersicht für die Admin-Oberfläche. */
export async function mapMatchingSummary() {
  const result = await pool.query(
    `SELECT
       count(*) FILTER (WHERE m.trip_id IS NULL) AS missing,
       count(*) FILTER (WHERE m.status = 'applied') AS applied,
       count(*) FILTER (WHERE m.status = 'rejected') AS rejected,
       count(*) FILTER (WHERE m.status = 'failed') AS failed
     FROM trips t
     LEFT JOIN trip_map_matches m ON m.trip_id = t.id
     WHERE t.status = 'completed' AND t.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM track_points p WHERE p.trip_id = t.id)
       -- Gesperrte Zeiträume werden nie gematcht, also nicht als offen zählen
       AND NOT EXISTS (
         SELECT 1 FROM trip_period_locks l
         WHERE l.user_id = t.user_id AND t.started_at::date BETWEEN l.period_start AND l.period_end
       )`,
  );
  const row = result.rows[0] || {};
  return Object.fromEntries(["missing", "applied", "rejected", "failed"].map((key) => [key, Number(row[key] || 0)]));
}
