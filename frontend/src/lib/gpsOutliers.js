// Hilfen zum Entfernen einzelner GPS-Punkte: Streckenlänge und Vorschläge für Ausreißer.

const EARTH_RADIUS = 6371000;

export function distanceMeters(a, b) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function normalizePoints(points) {
  return points
    .map((point) => ({ ...point, lat: Number(point.lat), lon: Number(point.lon) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
}

/** Länge der Linie durch die Punkte in Metern (wie die Distanz auf dem Server). */
export function routeLengthMeters(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distanceMeters(points[index - 1], points[index]);
  return total;
}

const MAX_PLAUSIBLE_SPEED = 70; // m/s ≈ 250 km/h
const POOR_ACCURACY = 150; // m

/**
 * Punkte, die vermutlich Sprünge sind: Der Umweg über den Punkt ist deutlich länger als
 * die direkte Verbindung der Nachbarn und dafür wäre eine unplausible Geschwindigkeit
 * nötig – oder das Gerät hat selbst eine sehr schlechte Genauigkeit gemeldet.
 * Nur ein Vorschlag; Start- und Endpunkt werden nie vorgeschlagen.
 */
export function suggestOutliers(points) {
  const result = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const toCurrent = distanceMeters(previous, current);
    const fromCurrent = distanceMeters(current, next);
    const direct = distanceMeters(previous, next);
    const seconds = (from, to) => Math.max(1, (new Date(to.recordedAt) - new Date(from.recordedAt)) / 1000);
    const speedIn = toCurrent / seconds(previous, current);
    const speedOut = fromCurrent / seconds(current, next);
    const detour = toCurrent + fromCurrent > 2.5 * direct + 150;
    const implausible = speedIn > MAX_PLAUSIBLE_SPEED || speedOut > MAX_PLAUSIBLE_SPEED;
    // Hin und zurück: weit weg und fast wieder dort, wo man vorher war
    const spike = Math.min(toCurrent, fromCurrent) > 200 && toCurrent + fromCurrent > 3 * direct;
    const inaccurate = Number(current.accuracy) > POOR_ACCURACY;
    if ((detour && (implausible || spike)) || inaccurate) result.push(current.id);
  }
  return result;
}
