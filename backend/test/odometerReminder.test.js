import assert from "node:assert/strict";
import { test } from "node:test";

process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const { reminderDueDate, parseReminderSettings, DEFAULT_REMINDER_SETTINGS } =
  await import("../src/services/odometerReminderService.js");

const base = { ...DEFAULT_REMINDER_SETTINGS, enabled: true, hour: 18 };

test("deaktiviert oder vor der eingestellten Stunde ist nichts fällig", () => {
  assert.equal(reminderDueDate({ ...base, enabled: false, frequency: "month_end" }, "UTC", new Date("2026-10-31T20:00:00Z")), null);
  assert.equal(reminderDueDate({ ...base, frequency: "month_end" }, "UTC", new Date("2026-10-31T17:59:00Z")), null);
  assert.equal(reminderDueDate({ ...base, frequency: "month_end" }, "UTC", new Date("2026-10-31T18:00:00Z")), "2026-10-31");
});

test("Monatsende berücksichtigt kurze Monate und Schaltjahre", () => {
  const settings = { ...base, frequency: "month_end" };
  assert.equal(reminderDueDate(settings, "UTC", new Date("2026-02-28T19:00:00Z")), "2026-02-28");
  assert.equal(reminderDueDate(settings, "UTC", new Date("2028-02-28T19:00:00Z")), null);
  assert.equal(reminderDueDate(settings, "UTC", new Date("2028-02-29T19:00:00Z")), "2028-02-29");
  assert.equal(reminderDueDate(settings, "UTC", new Date("2026-04-30T19:00:00Z")), "2026-04-30");
});

test("wöchentlich am eingestellten Wochentag (1 = Montag)", () => {
  const settings = { ...base, frequency: "weekly", weekday: 7 };
  assert.equal(reminderDueDate(settings, "UTC", new Date("2026-11-01T19:00:00Z")), "2026-11-01"); // Sonntag
  assert.equal(reminderDueDate(settings, "UTC", new Date("2026-11-02T19:00:00Z")), null); // Montag
});

test("monatlich am Tag X, höchstens der letzte Tag des Monats", () => {
  const settings = { ...base, frequency: "monthly", dayOfMonth: 28 };
  assert.equal(reminderDueDate(settings, "UTC", new Date("2026-03-28T19:00:00Z")), "2026-03-28");
  assert.equal(reminderDueDate({ ...settings, dayOfMonth: 15 }, "UTC", new Date("2026-03-14T19:00:00Z")), null);
});

test("Ortszeit entscheidet über den Kalendertag", () => {
  // 23:30 UTC am 30.09. ist in Berlin schon der 01.10., 01:30 Uhr
  const settings = { ...base, frequency: "monthly", dayOfMonth: 1, hour: 1 };
  assert.equal(reminderDueDate(settings, "Europe/Berlin", new Date("2026-09-30T23:30:00Z")), "2026-10-01");
  assert.equal(reminderDueDate(settings, "UTC", new Date("2026-09-30T23:30:00Z")), null);
});

test("Einstellungen werden geprüft, fehlende Felder bleiben erhalten", () => {
  const next = parseReminderSettings({ enabled: true, frequency: "weekly", weekday: 3 }, DEFAULT_REMINDER_SETTINGS);
  assert.deepEqual(next, { enabled: true, frequency: "weekly", weekday: 3, dayOfMonth: 1, hour: 18 });
  assert.throws(() => parseReminderSettings({ frequency: "daily" }));
  assert.throws(() => parseReminderSettings({ dayOfMonth: 31 }));
  assert.throws(() => parseReminderSettings({ hour: 24 }));
  assert.throws(() => parseReminderSettings({ enabled: "yes" }));
});
