import assert from "node:assert/strict";
import { test } from "node:test";

// config.js verlangt diese Werte beim Import; eine Datenbank wird hier nicht angesprochen
process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const {
  environmentMailSettings,
  fromHeader,
  getMailStatus,
  isMailSettingsComplete,
  transportOptions,
} = await import("../src/services/systemSettingsService.js");

test("SMTP aus der .env wird übernommen", () => {
  assert.equal(environmentMailSettings({}), null);
  const settings = environmentMailSettings({
    SMTP_HOST: "mail.example.de",
    SMTP_SECURE: "true",
    SMTP_USER: "user",
    SMTP_PASSWORD: "secret",
    SMTP_FROM: "fb@example.de",
  });
  assert.equal(settings.port, 465);
  assert.equal(settings.security, "tls");
  assert.equal(settings.fromAddress, "fb@example.de");
});

test("Transport-Optionen wie bisher aus SMTP_SECURE", () => {
  const base = { host: "h", port: 587, username: "u", password: "p" };
  assert.equal(transportOptions({ ...base, security: "tls" }).secure, true);
  assert.equal(transportOptions({ ...base, security: "starttls" }).secure, false);
  assert.equal(transportOptions({ ...base, username: "" }).auth, undefined);
});

test("Absender und Vollständigkeit", () => {
  assert.equal(fromHeader({ fromAddress: "a@b.de", fromName: 'Fahr"tenbuch' }), '"Fahrtenbuch" <a@b.de>');
  assert.equal(fromHeader({ fromAddress: "a@b.de" }), "a@b.de");
  assert.equal(isMailSettingsComplete({ host: "h" }), false);
  assert.equal(isMailSettingsComplete({ host: "h", fromAddress: "a@b.de" }), true);
});

test("Status für die Oberfläche enthält kein Passwort", () => {
  const status = getMailStatus({ SMTP_HOST: "h", SMTP_PASSWORD: "geheim", SMTP_FROM: "a@b.de" });
  assert.equal(status.configured, true);
  assert.equal(status.passwordSet, true);
  assert.equal("password" in status, false);
  assert.equal(getMailStatus({}).configured, false);
});
