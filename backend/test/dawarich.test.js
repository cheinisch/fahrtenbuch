import { test } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const { findGaps, normalizeBaseUrl, normalizeDawarichPoint } = await import("../src/services/dawarichService.js");

test("normalizeBaseUrl entfernt Schrägstriche und /api/v1", () => {
  assert.equal(normalizeBaseUrl("https://dawarich.example.com/"), "https://dawarich.example.com");
  assert.equal(normalizeBaseUrl(" https://example.com/dawarich/api/v1/ "), "https://example.com/dawarich");
  assert.equal(normalizeBaseUrl("http://10.0.0.5:3000?x=1"), "http://10.0.0.5:3000");
  assert.throws(() => normalizeBaseUrl("ftp://example.com"));
  assert.throws(() => normalizeBaseUrl("kein url"));
});

test("findGaps findet Beginn, Mitte und Ende ohne Punkte", () => {
  const start = "2026-10-22T14:13:17Z";
  const end = "2026-10-22T15:35:04Z";
  const gaps = findGaps(start, end, ["2026-10-22T14:13:20Z", "2026-10-22T14:13:30Z"]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].from, Date.parse("2026-10-22T14:13:30Z"));
  assert.equal(gaps[0].to, Date.parse(end));

  const withMiddle = findGaps(start, end, [
    "2026-10-22T14:15:00Z",
    "2026-10-22T14:15:05Z",
    "2026-10-22T14:40:00Z",
    "2026-10-22T15:35:00Z",
  ]);
  // 14:13:17→14:15:00, 14:15:05→14:40:00 und 14:40:00→15:35:00; die letzten 4 s sind keine Lücke
  assert.equal(withMiddle.length, 3);
  assert.equal(withMiddle[2].to, Date.parse("2026-10-22T15:35:00Z"));

  assert.deepEqual(findGaps(start, end, []), [{ from: Date.parse(start), to: Date.parse(end) }]);
});

test("normalizeDawarichPoint übernimmt gültige und verwirft ungenaue Punkte", () => {
  const point = normalizeDawarichPoint({
    latitude: "49.87",
    longitude: "8.62",
    timestamp: 1761142400,
    accuracy: 12,
    altitude: 180,
    course: 90,
    velocity: "50",
  });
  assert.equal(point.lat, 49.87);
  assert.equal(point.lon, 8.62);
  assert.equal(point.recordedAt.toISOString(), new Date(1761142400 * 1000).toISOString());
  assert.equal(point.bearing, 90);
  assert.equal(point.accuracy, 12);

  assert.equal(normalizeDawarichPoint({ latitude: "49", longitude: "8", timestamp: 1, accuracy: 500 }), null);
  assert.equal(normalizeDawarichPoint({ latitude: "0", longitude: "0", timestamp: 1 }), null);
  assert.equal(normalizeDawarichPoint({ latitude: "x", longitude: "8", timestamp: 1 }), null);
  assert.equal(normalizeDawarichPoint({ latitude: "49", longitude: "8", timestamp: 1, course: 360 }).bearing, null);
});
