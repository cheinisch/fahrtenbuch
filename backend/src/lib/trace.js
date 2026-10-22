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

// Lokale ebene Projektion (Meter) um einen Bezugspunkt – für Abstände bis
// einige hundert Kilometer genau genug und viel schneller als Haversine.
function projector(origin) {
  const k = Math.cos((origin.lat * Math.PI) / 180);
  return (p) => ({ x: (p.lon - origin.lon) * 111_320 * k, y: (p.lat - origin.lat) * 110_574 });
}

function segmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Abstandsindex für eine Linie: `distance(point)` liefert den Abstand zum
 * nächsten Segment in Metern. Ein Raster mit Zellen von `cellMeters` begrenzt
 * die Suche auf benachbarte Segmente; weiter entfernte Punkte werden exakt
 * über alle Segmente gemessen (selten, nur für Abweichungen).
 */
export function lineIndex(line, { cellMeters = 750, maxPoints = 4000 } = {}) {
  const project = projector(line[0]);
  const xy = samplePoints(line, maxPoints).map(project);
  const grid = new Map();
  const key = (cx, cy) => `${cx}:${cy}`;

  for (let i = 1; i < xy.length; i += 1) {
    const a = xy[i - 1];
    const b = xy[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cellMeters));
    const cells = new Set();
    for (let s = 0; s <= steps; s += 1) {
      cells.add(key(Math.floor((a.x + ((b.x - a.x) * s) / steps) / cellMeters), Math.floor((a.y + ((b.y - a.y) * s) / steps) / cellMeters)));
    }
    for (const c of cells) {
      if (!grid.has(c)) grid.set(c, []);
      grid.get(c).push(i);
    }
  }

  return {
    distance(point) {
      const p = project(point);
      if (xy.length === 1) return Math.hypot(p.x - xy[0].x, p.y - xy[0].y);
      const cx = Math.floor(p.x / cellMeters);
      const cy = Math.floor(p.y / cellMeters);
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const i of grid.get(key(cx + dx, cy + dy)) || []) {
            best = Math.min(best, segmentDistance(p, xy[i - 1], xy[i]));
          }
        }
      }
      if (best > cellMeters) {
        for (let i = 1; i < xy.length; i += 1) best = Math.min(best, segmentDistance(p, xy[i - 1], xy[i]));
      }
      return best;
    },
  };
}

/**
 * Wie weit weichen die Punkte von `from` von der Linie `to` ab? Liefert den
 * Anteil der Punkte weiter als `thresholdMeters` und den größten Abstand.
 */
export function routeDeviation(from, to, { thresholdMeters = 750, maxPoints = 2000 } = {}) {
  if (from.length === 0 || to.length < 2) return { offShare: 1, maxMeters: Infinity };
  const index = lineIndex(to, { cellMeters: thresholdMeters });
  const probes = samplePoints(from, maxPoints);
  let off = 0;
  let maxMeters = 0;
  for (const p of probes) {
    const d = index.distance(p);
    if (d > thresholdMeters) off += 1;
    maxMeters = Math.max(maxMeters, d);
  }
  return { offShare: off / probes.length, maxMeters: Math.round(maxMeters) };
}

/**
 * Abschnitte am Anfang und Ende der GPS-Spur, die die Straßenroute nicht
 * abdeckt (z. B. weil der Routing-Dienst dort keine Kartendaten hat).
 * Liefert die Zahl der Punkte vorne/hinten und den Anteil nicht abgedeckter
 * Punkte dazwischen.
 */
export function uncoveredEnds(points, route, { thresholdMeters = 750 } = {}) {
  const index = lineIndex(route, { cellMeters: thresholdMeters });
  const off = points.map((p) => index.distance(p) > thresholdMeters);
  let lead = 0;
  while (lead < off.length && off[lead]) lead += 1;
  let trail = 0;
  while (trail < off.length - lead && off[off.length - 1 - trail]) trail += 1;
  const middle = off.slice(lead, off.length - trail);
  const middleOff = middle.filter(Boolean).length;
  return { lead, trail, middleOffShare: middle.length ? middleOff / middle.length : 1 };
}

/**
 * Linie für die Kartenübersicht vereinfachen (Douglas-Peucker mit
 * `toleranceMeters`), danach höchstens `maxPoints` Punkte.
 */
export function simplifyRoute(points, { toleranceMeters = 15, maxPoints = 500 } = {}) {
  if (points.length <= 2) return points;
  const project = projector(points[0]);
  const xy = points.map(project);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let distance = toleranceMeters;
    for (let i = first + 1; i < last; i += 1) {
      const d = segmentDistance(xy[i], xy[first], xy[last]);
      if (d > distance) { distance = d; index = i; }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return samplePoints(points.filter((_, i) => keep[i]), maxPoints);
}
