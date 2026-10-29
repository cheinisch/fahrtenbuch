import assert from "node:assert/strict";
import test from "node:test";

import { basePathFromHref, prefixPath } from "../src/lib/basePath.js";

test("basePathFromHref liest den Unterpfad aus <base href>", () => {
  assert.equal(basePathFromHref("/abc123/"), "/abc123");
  assert.equal(basePathFromHref("/"), "");
  assert.equal(basePathFromHref(null), "");
  assert.equal(basePathFromHref("https://demo.example/x/y/"), "/x/y");
});

test("prefixPath setzt den Unterpfad nur vor App-Pfade", () => {
  assert.equal(prefixPath("/abc", "/api/v1/trips"), "/abc/api/v1/trips");
  assert.equal(prefixPath("", "/api/v1/trips"), "/api/v1/trips");
  assert.equal(prefixPath("/abc", "https://example.com/x"), "https://example.com/x");
  assert.equal(prefixPath("/abc", "//cdn.example/x"), "//cdn.example/x");
  assert.equal(prefixPath("/abc", "relative/path"), "relative/path");
});
