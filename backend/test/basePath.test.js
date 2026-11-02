import assert from "node:assert/strict";
import test from "node:test";

import {
  injectBaseHref,
  injectDemoMeta,
  normalizeDemoExpiresAt,
  normalizeDemoStatusUrl,
  normalizeBasePath,
  resolveBasePath,
  stripBasePath,
} from "../src/lib/basePath.js";

test("normalizeBasePath vereinheitlicht Slashes", () => {
  assert.equal(normalizeBasePath(""), "");
  assert.equal(normalizeBasePath("/"), "");
  assert.equal(normalizeBasePath("abc123"), "/abc123");
  assert.equal(normalizeBasePath("/abc123/"), "/abc123");
  assert.equal(normalizeBasePath("/tools/fahrtenbuch"), "/tools/fahrtenbuch");
});

test("normalizeBasePath lehnt unsichere Zeichen ab", () => {
  assert.throws(() => normalizeBasePath('/a"><script>'));
  assert.throws(() => normalizeBasePath("/a b"));
  assert.throws(() => normalizeBasePath("/a//b"));
});

test("resolveBasePath nutzt BASE_PATH vor PUBLIC_BASE_URL", () => {
  assert.equal(resolveBasePath(undefined, "https://demo.example/abc"), "/abc");
  assert.equal(resolveBasePath("", "https://demo.example"), "");
  assert.equal(resolveBasePath("/xyz", "https://demo.example/abc"), "/xyz");
  assert.equal(resolveBasePath(undefined, "kein-url"), "");
});

function rewrite(basePath, url) {
  const request = { url };
  stripBasePath(basePath)(request, null, () => {});
  return request.url;
}

test("stripBasePath entfernt nur den passenden Unterpfad", () => {
  assert.equal(rewrite("/abc", "/abc/api/v1/health"), "/api/v1/health");
  assert.equal(rewrite("/abc", "/abc"), "/");
  assert.equal(rewrite("/abc", "/abc?x=1"), "/?x=1");
  // Proxy hat schon gekürzt
  assert.equal(rewrite("/abc", "/api/v1/health"), "/api/v1/health");
  // Nur ganze Segmente
  assert.equal(rewrite("/abc", "/abcdef/x"), "/abcdef/x");
  assert.equal(rewrite("", "/abc/x"), "/abc/x");
});

test("injectBaseHref setzt den base-Tag in den head", () => {
  const html = "<!doctype html><html><head>\n<meta charset=\"UTF-8\" /></head><body></body></html>";
  assert.match(injectBaseHref(html, "/abc"), /<head>\n {4}<base href="\/abc\/" \/>/);
  assert.match(injectBaseHref(html, ""), /<base href="\/" \/>/);
  // Vorhandener base-Tag wird ersetzt statt verdoppelt
  const twice = injectBaseHref(injectBaseHref(html, "/abc"), "/xyz");
  assert.equal(twice.match(/<base /g).length, 1);
  assert.match(twice, /href="\/xyz\/"/);
});

test("Demo-Statusadresse wird geprüft und als Meta-Tag eingesetzt", () => {
  assert.equal(normalizeDemoStatusUrl(""), null);
  assert.equal(normalizeDemoStatusUrl("/api/session/abc123"), "/api/session/abc123");
  assert.throws(() => normalizeDemoStatusUrl("https://evil.example/x"));
  assert.throws(() => normalizeDemoStatusUrl('/x"><script>'));
  const html = "<html><head></head></html>";
  assert.equal(injectDemoMeta(html, null), html);
  assert.match(injectDemoMeta(html, "/api/session/abc"), /<meta name="fahrtenbuch-demo" content="\/api\/session\/abc" \/>/);
});

test("Fester Ablaufzeitpunkt für den Demo-Countdown", () => {
  assert.equal(normalizeDemoExpiresAt(""), null);
  assert.equal(normalizeDemoExpiresAt("1793288000"), 1793288000);
  assert.equal(normalizeDemoExpiresAt("2026-10-29T16:00:00Z"), 1793289600);
  assert.throws(() => normalizeDemoExpiresAt("bald"));
  const html = "<html><head></head></html>";
  assert.match(injectDemoMeta(html, null, 1793288000), /<meta name="fahrtenbuch-demo" content="" data-expires="1793288000" \/>/);
  assert.match(injectDemoMeta(html, "/api/session/abc", 5), /content="\/api\/session\/abc" data-expires="5"/);
});
