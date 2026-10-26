import assert from "node:assert/strict";
import { test } from "node:test";

process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const { tripRoutes } = await import("../src/routes/tripRoutes.js");
const { vehicleRoutes } = await import("../src/routes/vehicleRoutes.js");

/**
 * Feste Pfade (z. B. /archive) müssen vor Parameter-Pfaden derselben Methode stehen,
 * sonst fängt /:id sie ab („Das Feld id muss eine UUID sein“).
 */
function shadowedRoutes(router) {
  const routes = router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => ({ method, path: layer.route.path })));
  const problems = [];
  routes.forEach((route, index) => {
    if (route.path.includes(":")) return;
    const segments = route.path.split("/");
    const earlier = routes.slice(0, index).find((other) => {
      if (other.method !== route.method || !other.path.includes(":")) return false;
      const parts = other.path.split("/");
      return parts.length === segments.length && parts.every((part, i) => part.startsWith(":") || part === segments[i]);
    });
    if (earlier) problems.push(`${route.method.toUpperCase()} ${route.path} wird von ${earlier.path} verdeckt`);
  });
  return problems;
}

test("keine festen Fahrt-Routen hinter /:id", () => {
  assert.deepEqual(shadowedRoutes(tripRoutes), []);
});

test("keine festen Fahrzeug-Routen hinter /:id", () => {
  assert.deepEqual(shadowedRoutes(vehicleRoutes), []);
});
