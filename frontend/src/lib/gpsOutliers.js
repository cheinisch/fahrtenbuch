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
// Stillstand: so eng beieinander liegende Punkte gelten als „stehen“
const STATIONARY_RADIUS = 35; // m
const STATIONARY_MIN_POINTS = 4;
// Erst ab so viel Zitter-Strecke lohnt sich der Hinweis
const STATIONARY_MIN_JITTER = 100; // m

/** Gründe, in der Reihenfolge ihres Gewichts (für Anzeige und Übersetzung). */
export const PLAUSIBILITY_REASONS = ["jump", "spike", "time", "inaccurate", "stationary"];

// Gemessene Punkte prüfen; gesetzte (Editor) bzw. manuelle/erzeugte (API) sind gewollt
function isMeasured(point) {
  return point.origin !== "set" && (point.source == null || point.source === "gps");
}

function timeMs(point) {
  const value = point.recordedAt ? Date.parse(point.recordedAt) : NaN;
  return Number.isFinite(value) ? value : null;
}

/**
 * Plausibilitätsprüfung der GPS-Punkte. Liefert je auffälligem Punkt den Index in `points`
 * und die Gründe:
 * - jump: Umweg über den Punkt viel länger als die direkte Verbindung, dafür > 250 km/h nötig
 * - spike: weit weg und fast an derselben Stelle zurück
 * - time: Zeitstempel läuft rückwärts oder ist doppelt bei anderer Position
 * - inaccurate: das Gerät meldet selbst mehr als 150 m Ungenauigkeit
 * - stationary: GPS-Zittern im Stand (Punkte einer Stillstands-Wolke außer erstem und letztem)
 * Nur Vorschläge; Start- und Endpunkt der Fahrt werden nie markiert.
 */
export function checkPlausibility(points) {
  const reasons = new Map();
  const flag = (index, reason) => {
    if (index === 0 || index === points.length - 1) return;
    if (!reasons.has(index)) reasons.set(index, new Set());
    reasons.get(index).add(reason);
  };
  // Nur gemessene Punkte, mit ihrem Index in der Gesamtliste
  const measured = points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => isMeasured(point) && Number.isFinite(point.lat) && Number.isFinite(point.lon));

  for (let i = 0; i < measured.length; i += 1) {
    const { point: current, index } = measured[i];
    if (Number(current.accuracy) > POOR_ACCURACY) flag(index, "inaccurate");

    const previous = measured[i - 1]?.point;
    const next = measured[i + 1]?.point;

    if (previous) {
      const before = timeMs(previous);
      const now = timeMs(current);
      if (before != null && now != null && (now < before || (now === before && distanceMeters(previous, current) > 20))) {
        flag(index, "time");
      }
    }

    if (!previous || !next) continue;
    const toCurrent = distanceMeters(previous, current);
    const fromCurrent = distanceMeters(current, next);
    const direct = distanceMeters(previous, next);
    const speed = (meters, from, to) => {
      const a = timeMs(from);
      const b = timeMs(to);
      return a == null || b == null ? 0 : meters / Math.max(1, (b - a) / 1000);
    };
    const detour = toCurrent + fromCurrent > 2.5 * direct + 150;
    const implausible = speed(toCurrent, previous, current) > MAX_PLAUSIBLE_SPEED
      || speed(fromCurrent, current, next) > MAX_PLAUSIBLE_SPEED;
    const spike = Math.min(toCurrent, fromCurrent) > 200 && toCurrent + fromCurrent > 3 * direct;
    if (detour && implausible) flag(index, "jump");
    else if (detour && spike) flag(index, "spike");
  }

  // Stillstands-Wolken: aufeinanderfolgende Punkte im Umkreis des ersten Punkts der Gruppe
  let runStart = 0;
  const closeRun = (end) => {
    const run = measured.slice(runStart, end);
    if (run.length < STATIONARY_MIN_POINTS) return;
    const jitter = routeLengthMeters(run.map(({ point }) => point));
    const span = distanceMeters(run[0].point, run.at(-1).point);
    if (jitter - span < STATIONARY_MIN_JITTER) return;
    for (const { index } of run.slice(1, -1)) flag(index, "stationary");
  };
  for (let i = 1; i <= measured.length; i += 1) {
    const inside = i < measured.length && distanceMeters(measured[runStart].point, measured[i].point) <= STATIONARY_RADIUS;
    if (!inside) {
      closeRun(i);
      runStart = i;
    }
  }

  return [...reasons.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, set]) => ({ index, reasons: PLAUSIBILITY_REASONS.filter((reason) => set.has(reason)) }));
}

/**
 * Vorschläge für „Einzelne Punkte entfernen“ im Dashboard: Sprünge, Spitzen und ungenaue
 * Punkte (ids). Gleiche Regeln wie die Plausibilitätsprüfung im Fahrt-Editor.
 */
export function suggestOutliers(points) {
  const relevant = new Set(["jump", "spike", "inaccurate"]);
  return checkPlausibility(points)
    .filter((issue) => issue.reasons.some((reason) => relevant.has(reason)))
    .map((issue) => points[issue.index].id);
}
