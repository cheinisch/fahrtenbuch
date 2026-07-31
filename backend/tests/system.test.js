import test from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION } from "../src/config/version.js";

test("Version ist definiert", () => {
  assert.ok(APP_VERSION);
});
