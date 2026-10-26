import assert from "node:assert/strict";
import { test } from "node:test";

process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const { doublesBack } = await import("../src/services/routingService.js");

// Nach Norden, ~11 m je Schritt
const north = (from, count, lon = 8.0) => Array.from({ length: count }, (_, i) => [50 + (from + i) * 0.0001, lon]);

test("gerade Strecke fährt nicht zurück", () => {
  assert.equal(doublesBack(north(0, 100)), false);
});

test("Kehrtwende auf der Gegenfahrbahn wird erkannt", () => {
  // 600 m nach Norden, wenden, auf der 25 m entfernten Gegenfahrbahn 500 m zurück
  const out = north(0, 55);
  const back = north(5, 50, 8.00035).reverse();
  assert.equal(doublesBack([...out, ...back]), true);
});

test("Kreisverkehr ist keine Kehrtwende", () => {
  const ring = Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * 2 * Math.PI;
    return [50 + 0.0003 * Math.cos(angle), 8 + 0.00045 * Math.sin(angle)];
  });
  assert.equal(doublesBack([...north(-20, 20), ...ring, ...north(0, 20)]), false);
});
