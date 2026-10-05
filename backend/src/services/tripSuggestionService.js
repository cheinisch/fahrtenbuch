import { pool } from "../database/pool.js";

function haversineMeters(aLat, aLon, bLat, bLon) {
  const r = 6371000;
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export async function getLocationSuggestions(userId, trip) {
  if (trip.start_lat == null || trip.start_lon == null || trip.end_lat == null || trip.end_lon == null) {
    return [];
  }
  const [settingsResult, placesResult] = await Promise.all([
    pool.query(`SELECT settings FROM user_settings WHERE user_id=$1`, [userId]),
    pool.query(`SELECT * FROM saved_places WHERE user_id=$1 ORDER BY lower(name)`, [userId]),
  ]);
  const settings = settingsResult.rows[0]?.settings || {};
  const defaultRadius = Number(settings.locationRecognitionRadiusMeters || 250);
  const locations = [];
  if (settings.homeLocation) locations.push({ id: "home", name: "Zuhause", ...settings.homeLocation, radius_meters: defaultRadius });
  if (settings.workLocation) locations.push({ id: "work", name: "Arbeitsort", ...settings.workLocation, radius_meters: defaultRadius });
  for (const p of placesResult.rows) {
    locations.push({
      id: p.id, name: p.name, address: p.address, latitude: Number(p.latitude),
      longitude: Number(p.longitude), radius_meters: p.radius_meters || defaultRadius,
      suggested_type: p.suggested_type, purpose: p.purpose, contact: p.contact,
    });
  }
  const near = (lat, lon, location) =>
    haversineMeters(Number(lat), Number(lon), Number(location.latitude), Number(location.longitude)) <= Number(location.radius_meters || defaultRadius);
  const start = locations.filter((p) => near(trip.start_lat, trip.start_lon, p));
  const end = locations.filter((p) => near(trip.end_lat, trip.end_lon, p));
  const suggestions = [];
  for (const s of start) for (const e of end) {
    let type = e.suggested_type || null;
    let reason = `${s.name} → ${e.name}`;
    if ((s.id === "home" && e.id === "work") || (s.id === "work" && e.id === "home")) type = "commute";
    if (type) suggestions.push({
      type, reason, startPlace: s, endPlace: e,
      purpose: e.purpose || null, contact: e.contact || null,
    });
  }
  return suggestions;
}
