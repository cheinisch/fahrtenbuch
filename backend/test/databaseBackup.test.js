import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import test from "node:test";

process.env.POSTGRES_PASSWORD ??= "test";
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret";

const {
  backupFileName,
  createSetFilter,
  parseSchemaMigrationsCopy,
  sanitizeLabel,
} = await import("../src/services/databaseBackupService.js");
const { parseArguments } = await import("../src/cli/fahrtenbuch.js");

test("Dateiname enthält Zeitstempel und bereinigtes Label", () => {
  const date = new Date("2026-10-29T10:46:06.123Z");
  assert.equal(backupFileName(date), "fahrtenbuch-db-2026-10-29T10-46-06Z.dump");
  assert.equal(
    backupFileName(date, "Vor Update!"),
    "fahrtenbuch-db-2026-10-29T10-46-06Z-vor-update.dump",
  );
  assert.equal(sanitizeLabel("../../etc"), "etc");
});

test("Migrationsstand wird aus dem COPY-Block gelesen", () => {
  const sql = [
    "SET statement_timeout = 0;",
    "COPY public.schema_migrations (filename, applied_at) FROM stdin;",
    "0002_b.sql\t2026-01-01 00:00:00+00",
    "0001_a.sql\t2026-01-01 00:00:00+00",
    "\\.",
    "",
  ].join("\n");
  assert.deepEqual(parseSchemaMigrationsCopy(sql), ["0001_a.sql", "0002_b.sql"]);
  assert.deepEqual(parseSchemaMigrationsCopy("SELECT 1;"), []);
});

test("SET transaction_timeout wird für ältere Server entfernt", async () => {
  const script = [
    "SET statement_timeout = 0;",
    "SET transaction_timeout = 0;",
    "CREATE TABLE t (note text);",
    "COPY t (note) FROM stdin;",
    "SET transaction_timeout = 0;",
    "\\.",
    "",
  ].join("\n");
  const filtered = await text(Readable.from([script]).pipe(createSetFilter(16)));
  assert.equal(filtered.match(/transaction_timeout/g).length, 1, "nur im Kopf filtern");
  assert.match(filtered, /^SET statement_timeout = 0;\nCREATE TABLE/);
  const unchanged = await text(Readable.from([script]).pipe(createSetFilter(17)));
  assert.equal(unchanged, script);
});

test("Kommandozeilenargumente", () => {
  assert.deepEqual(parseArguments(["restore", "-", "--yes"]), {
    command: "restore",
    positional: ["-"],
    options: { yes: true },
  });
  assert.deepEqual(parseArguments(["backup", "--label", "vor update"]).options, {
    label: "vor update",
  });
  assert.equal(parseArguments([]).command, "help");
});
