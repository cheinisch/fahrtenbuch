// Zeit- und Streckenhilfen für den Fahrt-Editor (reine Funktionen, ohne React).

export function meters(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += meters(points[i - 1], points[i]);
  return total;
}

/**
 * Geschätzte Zeit je Punkt – wie der Server beim Speichern: erster Punkt = Start,
 * letzter = Ende, Punkte ohne Zeit nach Strecke zwischen den Nachbarn mit Zeit verteilt.
 */
export function estimateTimes(points, startMs, endMs) {
  if (!points.length || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return points.map(() => null);
  const times = points.map((point) => (point.recordedAt ? Date.parse(point.recordedAt) : null));
  times[0] = startMs;
  times[times.length - 1] = endMs;
  for (let i = 1; i < times.length - 1; i++) {
    if (times[i] != null) times[i] = Math.min(Math.max(times[i], startMs), endMs);
  }
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + meters(points[i - 1], points[i]));
  let anchor = 0;
  for (let i = 1; i < times.length; i++) {
    if (times[i] == null) continue;
    const span = cumulative[i] - cumulative[anchor];
    for (let j = anchor + 1; j < i; j++) {
      const ratio = span > 0 ? (cumulative[j] - cumulative[anchor]) / span : (j - anchor) / (i - anchor);
      times[j] = times[anchor] + (times[i] - times[anchor]) * ratio;
    }
    anchor = i;
  }
  for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) times[i] = times[i - 1];
  return times;
}

/**
 * Zeiträume ohne GPS-Messung: zwischen Start, gemessenen Punkten und Ende.
 * Gesetzte Punkte zählen nicht als Messung.
 */
export function gpsGaps(points, startMs, endMs, minimumMs = 2 * 60_000) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const measured = points
    .filter((point) => point.origin === "gps" && point.recordedAt)
    .map((point) => Date.parse(point.recordedAt))
    .filter((time) => time > startMs && time < endMs)
    .sort((a, b) => a - b);
  const bounds = [startMs, ...measured, endMs];
  const gaps = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1] - bounds[i] >= minimumMs) gaps.push({ from: bounds[i], to: bounds[i + 1] });
  }
  return gaps;
}

/**
 * Wo ein neuer Punkt hingehört: an die Stelle, an der er die Strecke am wenigsten
 * verlängert (zwischen zwei Punkten, davor oder dahinter).
 */
export function insertionIndex(points, point) {
  if (points.length === 0) return 0;
  if (points.length === 1) return 1;
  let bestIndex = points.length;
  let bestCost = meters(points.at(-1), point);
  const prepend = meters(point, points[0]);
  if (prepend < bestCost) { bestCost = prepend; bestIndex = 0; }
  for (let i = 0; i < points.length - 1; i++) {
    const cost = meters(points[i], point) + meters(point, points[i + 1]) - meters(points[i], points[i + 1]);
    if (cost < bestCost) { bestCost = cost; bestIndex = i + 1; }
  }
  return bestIndex;
}
