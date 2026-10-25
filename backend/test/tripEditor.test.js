import { test } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const { assignPointTimes, normalizeEditorPoints } = await import("../src/services/tripEditorService.js");
const { findPathGaps } = await import("../src/services/routingService.js");

const start = "2026-10-22T14:00:00Z";
const end = "2026-10-22T15:00:00Z";

test("assignPointTimes setzt Start/Ende und verteilt fehlende Zeiten nach Strecke", () => {
  // drei Punkte auf einer Linie, Abstand 1 : 3
  const points = [
    { lat: 50, lon: 8.0 },
    { lat: 50, lon: 8.01 },
    { lat: 50, lon: 8.04 },
  ];
  const times = assignPointTimes(points, start, end);
  assert.equal(times[0].toISOString(), "2026-10-22T14:00:00.000Z");
  assert.equal(times[2].toISOString(), "2026-10-22T15:00:00.000Z");
  assert.equal(times[1].toISOString(), "2026-10-22T14:15:00.000Z");
});

test("assignPointTimes behält vorhandene Zeiten und hält die Reihenfolge ein", () => {
  const points = [
    { lat: 50, lon: 8.0, recordedAt: "2026-10-22T13:50:00Z" },
    { lat: 50, lon: 8.01, recordedAt: "2026-10-22T14:30:00Z" },
    { lat: 50, lon: 8.02 },
    { lat: 50, lon: 8.03, recordedAt: "2026-10-22T14:20:00Z" },
    { lat: 50, lon: 8.04, recordedAt: "2026-10-22T16:00:00Z" },
  ];
  const times = assignPointTimes(points, start, end).map((date) => date.getTime());
  assert.equal(times[0], Date.parse(start));
  assert.equal(times[1], Date.parse("2026-10-22T14:30:00Z"));
  assert.equal(times.at(-1), Date.parse(end));
  for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1]);
});

test("normalizeEditorPoints prüft Koordinaten und verwirft ungültige Messwerte", () => {
  const points = normalizeEditorPoints([
    { lat: 50, lon: 8, accuracy: 5, bearing: 400 },
    { latitude: 50.1, longitude: 8.1 },
  ]);
  assert.equal(points[0].accuracy, 5);
  assert.equal(points[0].bearing, null);
  assert.equal(points[1].lat, 50.1);
  assert.throws(() => normalizeEditorPoints([{ lat: 50, lon: 8 }]));
  assert.throws(() => normalizeEditorPoints([{ lat: 95, lon: 8 }, { lat: 50, lon: 8 }]));
});

test("findPathGaps findet nur Abstände über der Schwelle", () => {
  const points = [
    { lat: 50, lon: 8.0 },
    { lat: 50, lon: 8.001 }, // ~70 m
    { lat: 50, lon: 8.02 }, // ~1,4 km
    { lat: 50, lon: 8.021 },
  ];
  assert.deepEqual(findPathGaps(points, 250), [1]);
  assert.deepEqual(findPathGaps(points, 50), [0, 1, 2]);
});
