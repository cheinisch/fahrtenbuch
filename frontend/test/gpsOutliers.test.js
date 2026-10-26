import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPlausibility, suggestOutliers } from "../src/lib/gpsOutliers.js";

// Gerade Fahrt nach Osten: alle 10 s ein Punkt, ca. 140 m Abstand (≈ 50 km/h)
function straight(count = 10) {
  const start = Date.parse("2026-10-26T08:00:00Z");
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    lat: 50.0,
    lon: 8.0 + i * 0.002,
    recordedAt: new Date(start + i * 10_000).toISOString(),
    accuracy: 8,
    origin: "gps",
  }));
}

const reasonsOf = (points) => Object.fromEntries(checkPlausibility(points).map((issue) => [issue.index, issue.reasons]));

test("saubere Fahrt hat keine Auffälligkeiten", () => {
  assert.deepEqual(checkPlausibility(straight()), []);
});

test("Sprung mit unplausibler Geschwindigkeit wird markiert", () => {
  const points = straight();
  points[4] = { ...points[4], lat: 50.05 }; // ~5,5 km zur Seite in 10 s
  assert.deepEqual(reasonsOf(points), { 4: ["jump"] });
  assert.deepEqual(suggestOutliers(points), ["p4"]);
});

test("rückwärts laufende Zeit wird markiert", () => {
  const points = straight();
  points[5] = { ...points[5], recordedAt: points[3].recordedAt };
  assert.ok(reasonsOf(points)[5].includes("time"));
});

test("ungenauer Punkt wird markiert", () => {
  const points = straight();
  points[3] = { ...points[3], accuracy: 400 };
  assert.deepEqual(reasonsOf(points), { 3: ["inaccurate"] });
});

test("Zittern im Stand: innere Punkte der Wolke werden markiert, nicht Start/Ende", () => {
  // Nach der kurzen Anfahrt (3 Punkte, bis 08:00:20)
  const start = Date.parse("2026-10-26T08:00:30Z");
  const jitter = [0, 0.0002, -0.0002, 0.0002, -0.0002, 0.0002, -0.0002, 0];
  const points = jitter.map((offset, i) => ({
    id: `s${i}`, lat: 50.0 + offset, lon: 8.0 + (i % 2) * 0.0002,
    recordedAt: new Date(start + i * 30_000).toISOString(), accuracy: 10, origin: "gps",
  }));
  const issues = reasonsOf([...straight(3).map((p) => ({ ...p, lon: p.lon - 0.01 })), ...points]);
  assert.ok(Object.values(issues).every((reasons) => reasons.includes("stationary")));
  assert.ok(Object.keys(issues).length >= 4);
  // Dashboard-Vorschläge bleiben bei Sprüngen/Ungenauigkeit
  assert.deepEqual(suggestOutliers(points), []);
});

test("gesetzte Punkte und Start/Ende werden nie markiert", () => {
  const points = straight();
  points[4] = { ...points[4], lat: 50.05, origin: "set", recordedAt: null };
  points[0] = { ...points[0], accuracy: 999 };
  assert.deepEqual(checkPlausibility(points), []);
});
