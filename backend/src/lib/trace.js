// Reine Hilfsfunktionen fürs Map-Matching (ohne Datenbank, gut testbar).
import { haversineDistance } from "./geo.js";

// Valhalla begrenzt Map-Matching standardmäßig auf 200 km Spurlänge
// (service_limits.trace.max_distance), Atlas nutzt Valhalla. Lange Fahrten
// werden deshalb in Abschnitte von höchstens 100 km zerlegt.
export const MAX_CHUNK_METERS = 100_000;

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

/**
 * Punkte in Abschnitte von höchstens maxMeters Spurlänge teilen. Der letzte
 * Punkt eines Abschnitts ist der erste des nächsten, damit keine Lücke entsteht.
 */
export function splitIntoChunks(points, maxMeters = MAX_CHUNK_METERS) {
  const chunks = [];
  let current = [points[0]];
  let length = 0;

  for (let i = 1; i < points.length; i += 1) {
    const step = haversineDistance(points[i - 1], points[i]);

    if (length + step > maxMeters && current.length >= 2) {
      chunks.push(current);
      current = [points[i - 1]];
      length = 0;
    }

    current.push(points[i]);
    length += step;
  }

  chunks.push(current);
  return chunks;
}

/**
 * GPS-Ausreißer entfernen: Punkte, die vom letzten gültigen Punkt aus nur mit
 * unmöglicher Geschwindigkeit erreichbar wären (Standard 70 m/s ≈ 250 km/h).
 * Kleine Sprünge (< minJumpMeters) bleiben, damit Messrauschen bei kurzen
 * Zeitabständen nicht ganze Abschnitte löscht. Punkte brauchen `time` in ms.
 */
export function dropOutliers(points, { maxSpeedMps = 70, minJumpMeters = 500 } = {}) {
  if (points.length < 3) return points;
  const kept = [points[0]];

  for (let i = 1; i < points.length; i += 1) {
    const previous = kept[kept.length - 1];
    const distance = haversineDistance(previous, points[i]);
    const seconds = Math.max(1, (points[i].time - previous.time) / 1000);

    if (distance > minJumpMeters && distance / seconds > maxSpeedMps) continue;
    kept.push(points[i]);
  }

  return kept;
}
