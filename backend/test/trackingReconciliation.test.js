import test from "node:test";
import assert from "node:assert/strict";

// config.js verlangt diese Werte beim Import; eine Datenbank wird hier nicht angesprochen
process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const { sameRecordingDevice } = await import("../src/services/trackingReconciliationService.js");
const { normalizeTripMergeGap, mapUserSettings, updateUserSettings, TRIP_MERGE_GAP_DEFAULT } = await import(
  "../src/services/userSettingsService.js"
);

test("gleiches Gerät wird nie als Doppelaufzeichnung zusammengeführt", () => {
  assert.equal(sameRecordingDevice({ device_id: "a" }, { device_id: "a" }), true);
});

test("verschiedene oder unbekannte Geräte bleiben Merge-Kandidaten", () => {
  assert.equal(sameRecordingDevice({ device_id: "a" }, { device_id: "b" }), false);
  assert.equal(sameRecordingDevice({ device_id: null }, { device_id: null }), false);
  assert.equal(sameRecordingDevice({ device_id: "a" }, {}), false);
});

test("Zeitfenster zum Zusammenführen: Standard, Grenzen, ungültige Werte", () => {
  assert.equal(normalizeTripMergeGap(undefined), TRIP_MERGE_GAP_DEFAULT);
  assert.equal(normalizeTripMergeGap(null), 0);
  assert.equal(normalizeTripMergeGap(0), 0);
  assert.equal(normalizeTripMergeGap(300), 300);
  assert.equal(normalizeTripMergeGap(5000), 5000);
  assert.equal(normalizeTripMergeGap(9000), 7200);
  assert.equal(normalizeTripMergeGap(-5), 0);
  assert.equal(normalizeTripMergeGap(1.5), 0);
  assert.equal(normalizeTripMergeGap("abc"), 0);
});

test("Profil liefert tripMergeGapSeconds", () => {
  assert.equal(mapUserSettings({ settings: {} }).tripMergeGapSeconds, 0);
  assert.equal(mapUserSettings({ settings: { tripMergeGapSeconds: 0 } }).tripMergeGapSeconds, 0);
  assert.equal(mapUserSettings({ settings: { tripMergeGapSeconds: 600 } }).tripMergeGapSeconds, 600);
  assert.equal(mapUserSettings({ settings: { tripMergeGapSeconds: 7200 } }).tripMergeGapSeconds, 7200);
});

test("PATCH lehnt ungültiges Zeitfenster ab", async () => {
  for (const bad of [-1, 7201, 1.5, "60", null]) {
    await assert.rejects(() => updateUserSettings("u", { tripMergeGapSeconds: bad }, { query: async () => ({ rows: [{}] }) }), (e) => e.code === "VALIDATION_ERROR" || e.status === 400 || /tripMergeGapSeconds/.test(e.message));
  }
});
