import assert from "node:assert/strict";
import { test } from "node:test";

import { routeDistance } from "../src/lib/geo.js";
import {
  decodePolyline6,
  dropOutliers,
  samplePoints,
  splitIntoChunks,
} from "../src/lib/trace.js";

// Gerade Linie nach Norden: 0,01° Breite ≈ 1,11 km
function northbound(count) {
  return Array.from({ length: count }, (_, i) => ({ lat: 50 + i * 0.01, lon: 8.3 }));
}

// Referenz-Encoder nach dem Google-Polyline-Algorithmus mit Präzision 1e6
function encodePolyline6(coordinates) {
  let output = "";
  let previous = [0, 0];
  const encodeValue = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = "";
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return chunk + String.fromCharCode(v + 63);
  };
  for (const [lat, lon] of coordinates) {
    const current = [Math.round(lat * 1e6), Math.round(lon * 1e6)];
    output += encodeValue(current[0] - previous[0]) + encodeValue(current[1] - previous[1]);
    previous = current;
  }
  return output;
}

test("decodePolyline6 round-trips Valhalla shapes", () => {
  const route = [[50.048, 8.288], [50.0505, 8.3], [53.541362, 9.98432], [-33.8688, 151.2093]];
  assert.deepEqual(decodePolyline6(encodePolyline6(route)), route);
  assert.deepEqual(decodePolyline6(""), []);
});

test("samplePoints keeps first and last point and the limit", () => {
  const points = northbound(1000);
  const sampled = samplePoints(points, 100);
  assert.equal(sampled.length, 100);
  assert.equal(sampled[0], points[0]);
  assert.equal(sampled.at(-1), points.at(-1));
  assert.equal(samplePoints(points.slice(0, 50), 100).length, 50);
});

test("splitIntoChunks keeps short trips in one piece", () => {
  const points = northbound(50); // ~54 km
  assert.equal(splitIntoChunks(points).length, 1);
});

test("splitIntoChunks splits long trips below the limit without gaps", () => {
  const points = northbound(480); // ~530 km, wie Geisenheim → Hamburg
  const chunks = splitIntoChunks(points);

  assert.ok(chunks.length >= 6, `expected >= 6 chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(routeDistance(chunk) <= 100_000, "chunk exceeds 100 km");
    assert.ok(chunk.length >= 2);
  }
  // Abschnitte schließen lückenlos aneinander an
  for (let i = 1; i < chunks.length; i += 1) {
    assert.equal(chunks[i][0], chunks[i - 1].at(-1));
  }
  // Summe der Abschnitte = Gesamtlänge
  const total = chunks.reduce((sum, chunk) => sum + routeDistance(chunk), 0);
  assert.ok(Math.abs(total - routeDistance(points)) <= chunks.length);
  assert.equal(chunks[0][0], points[0]);
  assert.equal(chunks.at(-1).at(-1), points.at(-1));
});

test("dropOutliers removes impossible jumps but keeps real movement", () => {
  // 1 Punkt pro Minute, ~1,1 km Abstand ≈ 67 km/h
  const points = northbound(20).map((p, i) => ({ ...p, time: i * 60_000 }));
  const withJump = points.map((p, i) => (i === 10 ? { ...p, lat: p.lat + 2 } : p));

  const cleaned = dropOutliers(withJump);
  assert.equal(cleaned.length, 19);
  assert.ok(!cleaned.includes(withJump[10]));
  assert.deepEqual(dropOutliers(points), points);
});

test("dropOutliers keeps gaps that are plausible over time", () => {
  // 50 km Lücke in 30 Minuten (100 km/h) ist eine echte Aufzeichnungslücke
  const points = [
    { lat: 50, lon: 8.3, time: 0 },
    { lat: 50.01, lon: 8.3, time: 60_000 },
    { lat: 50.46, lon: 8.3, time: 1_860_000 },
  ];
  assert.equal(dropOutliers(points).length, 3);
});
