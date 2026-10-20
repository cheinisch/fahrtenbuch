import { pool } from "../database/pool.js";
import { badRequest } from "../lib/errors.js";
import { tripLocalStartSql, tripZoneSql, userTimeZone } from "../lib/timezone.js";
import { vehicleTripScopeSql } from "../lib/vehicleScope.js";

// Monatsbericht eines Benutzers: alle eigenen und freigegebenen Fahrzeuge, offene
// (nicht zugeordnete) Fahrten und Orte, die im Monat zum ersten Mal angefahren wurden.
// Monatsgrenzen gelten in der Ortszeit der Fahrt (wie in der Statistik).

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DEFAULT_RADIUS_METERS = 250;
const MAX_NEW_PLACES = 10;
const MAX_OPEN_TRIPS = 50;

/** "2026-09" prüfen; ohne Angabe der Vormonat in der Kontozeitzone. */
export function parseReportMonth(value, timeZone, now = new Date()) {
  if (value === undefined || value === null || value === "") {
    return previousMonth(timeZone, now);
  }
  const match = MONTH_PATTERN.exec(String(value));
  if (!match) {
    throw badRequest("VALIDATION_ERROR", "Der Monat muss als YYYY-MM angegeben werden.");
  }
  return `${match[1]}-${match[2]}`;
}

/** Lokales Jahr/Monat/Tag/Stunde in einer Zone. */
export function localParts(timeZone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) };
}

export function previousMonth(timeZone, now = new Date()) {
  const { year, month } = localParts(timeZone, now);
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function nextMonthStart(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export function haversineMeters(aLat, aLon, bLat, bLon) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const km = (meters) => Math.round(Number(meters || 0)) / 1000;

function haversineSql(latA, lonA, latB, lonB) {
  return `(2 * 6371000 * asin(sqrt(
    power(sin(radians(${latB} - ${latA}) / 2), 2) +
    cos(radians(${latA})) * cos(radians(${latB})) * power(sin(radians(${lonB} - ${lonA}) / 2), 2)
  )))`;
}

async function loadVehicles(client, userId, month, timeZone) {
  const start = `${month}-01`;
  const end = nextMonthStart(month);
  const local = tripLocalStartSql("t", "$4");
  const result = await client.query(
    `
    WITH month_trips AS (
      SELECT t.* FROM trips t
      WHERE t.archived_at IS NULL AND t.status = 'completed'
        AND ${local}::date >= $2::date AND ${local}::date < $3::date
    ),
    vm AS (
      SELECT v.id, v.name, v.license_plate, (v.user_id = $1) AS is_owner,
             o.display_name AS owner_display_name, o.username AS owner_username
      FROM vehicles v
      JOIN users o ON o.id = v.user_id
      WHERE (
          (v.archived_at IS NULL AND (
            v.user_id = $1
            OR EXISTS (SELECT 1 FROM vehicle_shares vs WHERE vs.vehicle_id = v.id AND vs.user_id = $1)
          ))
          OR EXISTS (SELECT 1 FROM month_trips own WHERE own.vehicle_id = v.id AND own.user_id = $1)
        )
    ),
    d AS (
      SELECT t.vehicle_id,
        coalesce(sum(t.distance_meters), 0)::bigint AS tracked_meters,
        coalesce(sum(t.distance_meters) FILTER (WHERE t.user_id = $1 AND t.type = 'business'), 0)::bigint AS business_meters,
        coalesce(sum(t.distance_meters) FILTER (WHERE t.user_id = $1 AND t.type = 'private'), 0)::bigint AS private_meters,
        coalesce(sum(t.distance_meters) FILTER (WHERE t.user_id = $1 AND t.type = 'commute'), 0)::bigint AS commute_meters,
        coalesce(sum(t.distance_meters) FILTER (WHERE t.user_id = $1 AND t.type = 'unclassified'), 0)::bigint AS unclassified_meters,
        coalesce(sum(t.distance_meters) FILTER (WHERE t.user_id <> $1), 0)::bigint AS other_drivers_meters,
        count(*) FILTER (WHERE t.user_id = $1)::int AS own_trips,
        count(*) FILTER (WHERE t.user_id = $1 AND t.type = 'unclassified')::int AS open_trips
      FROM month_trips t
      WHERE ${vehicleTripScopeSql("t", "$1")}
      GROUP BY t.vehicle_id
    )
    SELECT vm.*, d.*,
      start_r.odometer_meters AS start_odometer_meters, start_r.reading_date AS start_reading_date,
      end_r.odometer_meters AS end_odometer_meters, end_r.reading_date AS end_reading_date
    FROM vm
    LEFT JOIN d ON d.vehicle_id = vm.id
    LEFT JOIN LATERAL (
      SELECT r.odometer_meters, r.reading_date FROM vehicle_odometer_readings r
      WHERE vm.is_owner AND r.user_id = $1 AND r.vehicle_id = vm.id AND r.reading_date <= $2::date
      ORDER BY r.reading_date DESC LIMIT 1
    ) start_r ON true
    LEFT JOIN LATERAL (
      SELECT r.odometer_meters, r.reading_date FROM vehicle_odometer_readings r
      WHERE vm.is_owner AND r.user_id = $1 AND r.vehicle_id = vm.id AND r.reading_date <= $3::date
      ORDER BY r.reading_date DESC LIMIT 1
    ) end_r ON true
    ORDER BY vm.is_owner DESC, lower(vm.name)
    `,
    [userId, start, end, timeZone],
  );

  return result.rows.map((row) => {
    // Mitnutzer sehen nur ihre eigenen Fahrten: keine Ablesungen, keine anderen Fahrer
    const otherDrivers = row.is_owner ? Number(row.other_drivers_meters || 0) : 0;
    const tracked = Number(row.tracked_meters || 0) - Number(row.other_drivers_meters || 0) + otherDrivers;
    const hasActual = row.is_owner
      && row.start_odometer_meters != null && row.end_odometer_meters != null
      && String(row.start_reading_date) !== String(row.end_reading_date);
    const actual = hasActual ? Math.max(0, Number(row.end_odometer_meters) - Number(row.start_odometer_meters)) : null;
    return {
      id: row.id,
      name: row.name,
      licensePlate: row.license_plate || null,
      access: row.is_owner ? "owner" : "shared",
      ownerName: row.is_owner ? null : (row.owner_display_name || row.owner_username || null),
      tripCount: Number(row.own_trips || 0),
      openTripCount: Number(row.open_trips || 0),
      drivenKm: km(actual ?? tracked),
      actualKm: actual == null ? null : km(actual),
      trackedKm: km(tracked),
      businessKm: km(row.business_meters),
      privateKm: km(row.private_meters),
      commuteKm: km(row.commute_meters),
      unclassifiedKm: km(row.unclassified_meters),
      otherDriversKm: km(otherDrivers),
      unexplainedKm: actual == null ? null : km(Math.max(0, actual - tracked)),
      endOdometerKm: row.is_owner && row.end_odometer_meters != null ? km(row.end_odometer_meters) : null,
    };
  }).filter((vehicle) => vehicle.tripCount > 0 || vehicle.trackedKm > 0 || (vehicle.actualKm || 0) > 0);
}

async function loadOpenTrips(client, userId, month, timeZone) {
  const start = `${month}-01`;
  const end = nextMonthStart(month);
  const local = tripLocalStartSql("t", "$4");
  const zone = tripZoneSql("t", "$4");
  const result = await client.query(
    `
    SELECT t.id, t.vehicle_id, v.name AS vehicle_name, t.started_at, t.ended_at,
      to_char(${local}, 'YYYY-MM-DD"T"HH24:MI') AS local_start,
      to_char(t.ended_at AT TIME ZONE ${zone}, 'YYYY-MM-DD"T"HH24:MI') AS local_end,
      t.start_address, t.end_address, t.distance_meters,
      count(*) OVER () AS total
    FROM trips t
    JOIN vehicles v ON v.id = t.vehicle_id
    WHERE t.user_id = $1 AND t.archived_at IS NULL AND t.status = 'completed' AND t.type = 'unclassified'
      AND ${local}::date >= $2::date AND ${local}::date < $3::date
    ORDER BY t.started_at
    LIMIT ${MAX_OPEN_TRIPS}
    `,
    [userId, start, end, timeZone],
  );
  const older = await client.query(
    `
    SELECT count(*)::int AS count FROM trips t
    WHERE t.user_id = $1 AND t.archived_at IS NULL AND t.status = 'completed' AND t.type = 'unclassified'
      AND ${tripLocalStartSql("t", "$3")}::date < $2::date
    `,
    [userId, start, timeZone],
  );
  return {
    trips: result.rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      vehicleName: row.vehicle_name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      localStart: row.local_start,
      localEnd: row.local_end,
      startAddress: row.start_address || null,
      endAddress: row.end_address || null,
      distanceKm: km(row.distance_meters),
    })),
    total: Number(result.rows[0]?.total || 0),
    olderCount: Number(older.rows[0]?.count || 0),
  };
}

/**
 * Ziele dieses Monats in Gruppen zusammenfassen (Erkennungsradius des Benutzers) und
 * nur die behalten, zu denen es vor dem Monat keine Fahrt gab – gespeichert oder nicht.
 */
export function clusterDestinations(trips, radius, ignored = []) {
  const clusters = [];
  for (const trip of trips) {
    if (trip.end_lat == null || trip.end_lon == null) continue;
    const lat = Number(trip.end_lat);
    const lon = Number(trip.end_lon);
    if (ignored.some((place) => haversineMeters(lat, lon, place.latitude, place.longitude) <= radius)) continue;
    let cluster = clusters.find((item) => haversineMeters(lat, lon, item.latitude, item.longitude) <= radius);
    if (!cluster) {
      cluster = { latitude: lat, longitude: lon, points: 0, arrivals: [] };
      clusters.push(cluster);
    }
    // Laufender Mittelpunkt, damit sich die Gruppe nicht vom ersten Punkt wegzieht
    cluster.latitude = (cluster.latitude * cluster.points + lat) / (cluster.points + 1);
    cluster.longitude = (cluster.longitude * cluster.points + lon) / (cluster.points + 1);
    cluster.points += 1;
    cluster.arrivals.push(trip);
  }
  return clusters;
}

async function loadNewPlaces(client, userId, month, timeZone) {
  const start = `${month}-01`;
  const end = nextMonthStart(month);
  const local = tripLocalStartSql("t", "$4");
  const [settingsResult, placesResult, tripsResult] = await Promise.all([
    client.query(`SELECT settings FROM user_settings WHERE user_id = $1`, [userId]),
    client.query(`SELECT id, name, latitude, longitude, radius_meters FROM saved_places WHERE user_id = $1`, [userId]),
    client.query(
      `
      SELECT t.id, t.type, t.purpose, t.distance_meters, t.start_lat, t.start_lon, t.end_lat, t.end_lon,
        t.end_address, t.started_at, to_char(${local}, 'YYYY-MM-DD') AS local_date
      FROM trips t
      WHERE t.user_id = $1 AND t.archived_at IS NULL AND t.status = 'completed'
        AND ${local}::date >= $2::date AND ${local}::date < $3::date
      ORDER BY t.started_at
      `,
      [userId, start, end, timeZone],
    ),
  ]);

  const settings = settingsResult.rows[0]?.settings || {};
  const radius = Number(settings.locationRecognitionRadiusMeters || DEFAULT_RADIUS_METERS);
  // Zuhause und Arbeitsort sind nie „neu“
  const ignored = [settings.homeLocation, settings.workLocation]
    .filter((place) => place && Number.isFinite(Number(place.latitude)) && Number.isFinite(Number(place.longitude)))
    .map((place) => ({ latitude: Number(place.latitude), longitude: Number(place.longitude) }));

  const clusters = clusterDestinations(tripsResult.rows, radius, ignored);
  if (!clusters.length) return [];

  // Gab es schon vor diesem Monat eine Fahrt von oder zu diesem Ort?
  const known = await client.query(
    `
    SELECT c.idx
    FROM unnest($2::float8[], $3::float8[], $4::int[]) AS c(lat, lon, idx)
    WHERE EXISTS (
      SELECT 1 FROM trips t
      WHERE t.user_id = $1 AND t.archived_at IS NULL AND t.status = 'completed'
        AND ${tripLocalStartSql("t", "$7")}::date < $6::date
        AND (
          (t.end_lat BETWEEN c.lat - $5 / 111320.0 AND c.lat + $5 / 111320.0
            AND t.end_lon BETWEEN c.lon - $5 / (111320.0 * cos(radians(c.lat))) AND c.lon + $5 / (111320.0 * cos(radians(c.lat)))
            AND ${haversineSql("c.lat", "c.lon", "t.end_lat", "t.end_lon")} <= $5)
          OR
          (t.start_lat BETWEEN c.lat - $5 / 111320.0 AND c.lat + $5 / 111320.0
            AND t.start_lon BETWEEN c.lon - $5 / (111320.0 * cos(radians(c.lat))) AND c.lon + $5 / (111320.0 * cos(radians(c.lat)))
            AND ${haversineSql("c.lat", "c.lon", "t.start_lat", "t.start_lon")} <= $5)
        )
    )
    `,
    [
      userId,
      clusters.map((cluster) => cluster.latitude),
      clusters.map((cluster) => cluster.longitude),
      clusters.map((_, index) => index),
      radius,
      start,
      timeZone,
    ],
  );
  const knownIndexes = new Set(known.rows.map((row) => Number(row.idx)));

  return clusters
    .map((cluster, index) => ({ cluster, index }))
    .filter(({ index }) => !knownIndexes.has(index))
    .map(({ cluster }) => {
      const near = (lat, lon) => lat != null && lon != null
        && haversineMeters(Number(lat), Number(lon), cluster.latitude, cluster.longitude) <= radius;
      // Hin- und Rückfahrten: alle Fahrten des Monats, die dort enden oder beginnen
      const related = tripsResult.rows.filter((trip) => near(trip.end_lat, trip.end_lon) || near(trip.start_lat, trip.start_lon));
      const first = cluster.arrivals[0];
      const typeCounts = {};
      const purposeCounts = {};
      for (const trip of related) {
        if (trip.type !== "unclassified") typeCounts[trip.type] = (typeCounts[trip.type] || 0) + 1;
        if (trip.purpose) purposeCounts[trip.purpose] = (purposeCounts[trip.purpose] || 0) + 1;
      }
      const top = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const saved = placesResult.rows
        .map((place) => ({ place, distance: haversineMeters(cluster.latitude, cluster.longitude, Number(place.latitude), Number(place.longitude)) }))
        .filter(({ place, distance }) => distance <= Number(place.radius_meters || radius))
        .sort((a, b) => a.distance - b.distance)[0]?.place || null;
      return {
        key: `${cluster.latitude.toFixed(5)},${cluster.longitude.toFixed(5)}`,
        address: first.end_address || null,
        latitude: Number(cluster.latitude.toFixed(6)),
        longitude: Number(cluster.longitude.toFixed(6)),
        firstVisit: first.local_date,
        tripCount: related.length,
        distanceKm: km(related.reduce((sum, trip) => sum + Number(trip.distance_meters || 0), 0)),
        openTripCount: related.filter((trip) => trip.type === "unclassified").length,
        mainType: top(typeCounts),
        purpose: top(purposeCounts),
        savedPlace: saved ? { id: saved.id, name: saved.name } : null,
      };
    })
    .sort((a, b) => a.firstVisit.localeCompare(b.firstVisit))
    .slice(0, MAX_NEW_PLACES);
}

export async function buildMonthlyReport(userId, monthInput, { client = pool, now = new Date() } = {}) {
  const timeZone = await userTimeZone(client, userId);
  const month = parseReportMonth(monthInput, timeZone, now);
  const [vehicles, open, newPlaces, settingsResult] = await Promise.all([
    loadVehicles(client, userId, month, timeZone),
    loadOpenTrips(client, userId, month, timeZone),
    loadNewPlaces(client, userId, month, timeZone),
    client.query(`SELECT settings FROM user_settings WHERE user_id = $1`, [userId]),
  ]);
  const settings = settingsResult.rows[0]?.settings || {};
  const round = (value) => Math.round(value * 1000) / 1000;
  const totals = {
    drivenKm: round(vehicles.reduce((sum, vehicle) => sum + vehicle.drivenKm, 0)),
    businessKm: round(vehicles.reduce((sum, vehicle) => sum + vehicle.businessKm, 0)),
    tripCount: vehicles.reduce((sum, vehicle) => sum + vehicle.tripCount, 0),
    openTripCount: open.total,
    openKm: round(vehicles.reduce((sum, vehicle) => sum + vehicle.unclassifiedKm, 0)),
  };

  return {
    month,
    from: `${month}-01`,
    to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10),
    timeZone,
    distanceUnit: settings.distanceUnit === "mi" ? "mi" : "km",
    totals,
    vehicles,
    openTrips: open.trips,
    olderOpenTripCount: open.olderCount,
    newPlaces,
    isEmpty: totals.tripCount === 0 && totals.drivenKm === 0 && open.olderCount === 0,
  };
}
