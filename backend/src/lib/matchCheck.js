// Prüfung gematchter Abschnitte gegen die GPS-Spur (ohne Datenbank, gut testbar).
import { routeDistance } from "./geo.js";
import { routeDeviation, uncoveredEnds } from "./trace.js";

// Plausibilitätsgrenzen: Map-Matching schließt Lücken entlang der Straße, die
// Distanz wird also meist etwas länger. Deutlich kürzer oder vielfach länger
// spricht für ein Fehlmatching.
export const MIN_RATIO = 0.8;
export const MAX_RATIO = 2.5;

// Geometrische Prüfung je Abschnitt: Die Straßenroute muss der GPS-Spur
// folgen (und umgekehrt). Ein Umweg über eine falsche Autobahnauffahrt oder
// ein fehlender Abschnitt fällt sonst durch die reine Distanzprüfung.
const OFF_ROUTE_METERS = 750;
const MAX_OFF_SHARE = 0.03;
const MAX_OFF_METERS = 5_000;

const km = (meters) => `${(meters / 1000).toFixed(1).replace(".", ",")} km`;

/**
 * Gematchten Abschnitt gegen die GPS-Spur prüfen.
 * - Fehlt der Route der Anfang oder das Ende (der Dienst hat dort z. B. keine
 *   Kartendaten, etwa im Ausland), wird dort die GPS-Spur angesetzt (`note`).
 * - Fehlt mittendrin etwas oder macht die Route Umwege abseits der Spur,
 *   wird der Abschnitt verworfen (`reason`).
 */
export function checkChunk(rawPoints, part) {
  if (!Number.isFinite(part.distanceMeters) || part.distanceMeters <= 0 || part.route.length < 2) {
    return { reason: "keine Route geliefert" };
  }

  const route = part.route.map(([lat, lon]) => ({ lat, lon }));
  const ends = uncoveredEnds(rawPoints, route, { thresholdMeters: OFF_ROUTE_METERS });
  if (ends.lead + ends.trail >= rawPoints.length - 1) {
    return { reason: "Route liegt abseits der GPS-Spur" };
  }
  if (ends.middleOffShare > MAX_OFF_SHARE) {
    return { reason: "Route deckt Teile der GPS-Spur nicht ab" };
  }

  const away = routeDeviation(route, rawPoints, { thresholdMeters: OFF_ROUTE_METERS });
  if (away.offShare > MAX_OFF_SHARE || away.maxMeters > MAX_OFF_METERS) {
    return { reason: `Route weicht bis zu ${km(away.maxMeters)} von der GPS-Spur ab` };
  }

  // Fehlenden Anfang/Ende mit der GPS-Spur ergänzen (bis zum ersten bzw. ab dem
  // letzten abgedeckten Punkt, damit die Linie anschließt)
  const head = ends.lead ? rawPoints.slice(0, ends.lead + 1) : [];
  const tail = ends.trail ? rawPoints.slice(rawPoints.length - ends.trail - 1) : [];
  const patched = {
    ...part,
    distanceMeters: part.distanceMeters + routeDistance(head) + routeDistance(tail),
    route: [...head.map((p) => [p.lat, p.lon]), ...part.route, ...tail.map((p) => [p.lat, p.lon])],
  };

  const rawMeters = routeDistance(rawPoints);
  // Kurze Abschnitte (Rangieren, wenige Meter) nicht an der Quote messen
  if (rawMeters >= 1_000) {
    const ratio = patched.distanceMeters / rawMeters;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) return { reason: `Distanz ${(ratio * 100).toFixed(0)} % der GPS-Distanz` };
  }

  const parts = [];
  if (head.length) parts.push(`Anfang (${km(routeDistance(head))})`);
  if (tail.length) parts.push(`Ende (${km(routeDistance(tail))})`);
  return { part: patched, note: parts.length ? `${parts.join(" und ")} ohne Straßenzuordnung` : null };
}

