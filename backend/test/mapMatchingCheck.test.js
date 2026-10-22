import assert from "node:assert/strict";
import { test } from "node:test";

import { checkChunk } from "../src/lib/matchCheck.js";

// Ost-West-Linie auf 50° N: 0,01° Länge ≈ 715 m
const line = (from, to) => Array.from({ length: to - from }, (_, i) => ({ lat: 50, lon: 8 + (from + i) * 0.01 }));
const asRoute = (points) => points.map((p) => [p.lat, p.lon]);
const meters = (count) => count * 715;

test("fehlender Anfang wird mit der GPS-Spur ergänzt", () => {
  const raw = line(0, 100);
  // Dienst liefert erst ab Punkt 40 (z. B. keine Kartendaten im Ausland)
  const result = checkChunk(raw, { distanceMeters: meters(59), route: asRoute(line(40, 100)), confidence: null });
  assert.equal(result.reason, undefined);
  assert.match(result.note, /^Anfang/);
  assert.equal(result.part.route[0][1], 8);
  assert.ok(Math.abs(result.part.distanceMeters - meters(99)) < 2_000);
});

test("Umweg abseits der Spur verwirft den Abschnitt", () => {
  const raw = line(0, 100);
  // Route folgt der Spur, fährt aber zwischendurch 15 km nach Süden und zurück
  const detour = [...line(0, 45), { lat: 49.865, lon: 8.45 }, ...line(45, 100)];
  const result = checkChunk(raw, { distanceMeters: meters(110), route: asRoute(detour), confidence: null });
  assert.match(result.reason, /weicht/);
});

test("fehlende Mitte verwirft den Abschnitt", () => {
  const raw = line(0, 100);
  const gap = [...line(0, 40), { lat: 49.8, lon: 8.45 }, ...line(50, 100)];
  const result = checkChunk(raw, { distanceMeters: meters(110), route: asRoute(gap), confidence: null });
  assert.match(result.reason, /deckt/);
});

test("passende Route wird unverändert übernommen", () => {
  const raw = line(0, 100);
  const result = checkChunk(raw, { distanceMeters: meters(99), route: asRoute(raw), confidence: null });
  assert.equal(result.reason, undefined);
  assert.equal(result.note, null);
});
