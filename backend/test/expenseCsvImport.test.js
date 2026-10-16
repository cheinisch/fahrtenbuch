import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeCsv,
  mapCostCategory,
  parseDate,
  parseNumber,
  parseTankType,
} from "../src/services/expenseCsvImport.js";

const SPRITMONITOR_FUEL_DE = [
  "Datum;Km-Stand;Teil-Km;Spritmenge;Kosten;Währung;Tankart;Reifen;Strecken;Fahrweise;Kraftstoff;Bemerkung;Verbrauch;BC-Verbrauch;BC-Spritmenge;BC-Geschwindigkeit;Tankstelle;Land;Großraum;Ort",
  "08.08.2026;199166;525;22,23;46,44;EUR;1;1;14;2;1;;4,23;;;;Aral Geisenheim;D;;",
  "12.07.2026;198641;599;26,93;53,03;EUR;2;1;14;3;1;;4,5;;;;;D;;",
  "24.06.2026;198042;542,5;26,12;44,12;EUR;3;1;14;3;1;Testtankung;4,81;;;;;D;;",
].join("\n");

test("erkennt Spritmonitor-Tankungen (deutsch, Semikolon, Dezimalkomma)", () => {
  const analysis = analyzeCsv(Buffer.from(SPRITMONITOR_FUEL_DE, "utf8"));
  assert.equal(analysis.delimiter, ";");
  assert.equal(analysis.suggestion.source, "spritmonitor");
  assert.equal(analysis.options.kind, "fuel");
  assert.equal(analysis.options.dateFormat, "DD.MM.YYYY");
  assert.equal(analysis.options.decimalSeparator, ",");
  assert.equal(analysis.result.errors.length, 0);

  const [first, second, third] = analysis.result.entries;
  assert.deepEqual(
    { date: first.date, odometerMeters: first.odometerMeters, quantity: first.quantity, amountCents: first.amountCents, fullTank: first.fullTank, vendor: first.vendor },
    { date: "2026-08-08", odometerMeters: 199166000, quantity: 22.23, amountCents: 4644, fullTank: true, vendor: "Aral Geisenheim" },
  );
  assert.equal(second.fullTank, false);
  assert.equal(third.fullTank, true); // erste Tankung = Startpunkt
  assert.equal(third.notes, "Testtankung");
  assert.equal(first.quantityUnit, "l");
});

test("liest Windows-1252-kodierte Dateien", () => {
  const latin1 = Buffer.from(SPRITMONITOR_FUEL_DE.replace("Währung", "Währung"), "latin1");
  const analysis = analyzeCsv(latin1);
  assert.equal(analysis.encoding, "windows-1252");
  assert.ok(analysis.headers.includes("Währung"));
  assert.equal(analysis.result.entries.length, 3);
});

test("erkennt Kosten-Exporte und ordnet Kategorien zu", () => {
  const csv = [
    "Datum;Km-Stand;Kostenart;Bezeichnung;Kosten;Währung;Bemerkung",
    "02.01.2026;150000;Versicherung;Haftpflicht + Teilkasko;612,40;EUR;",
    "15.03.2026;151200;Wartung;Inspektion mit Ölwechsel;389,90;EUR;Autohaus",
    "20.03.2026;;Sonstiges;Vignette Österreich;11,50;EUR;",
    "21.03.2026;;Notiz;Reifendruck geprüft;;EUR;",
    "kaputt;;;;;;",
  ].join("\n");
  const analysis = analyzeCsv(Buffer.from(csv));
  assert.equal(analysis.options.kind, "costs");
  const categories = analysis.result.entries.map((entry) => entry.category);
  assert.deepEqual(categories, ["insurance", "maintenance", "toll"]);
  assert.equal(analysis.result.entries[0].amountCents, 61240);
  assert.equal(analysis.result.warnings.filter((warning) => /Notiz/.test(warning.message)).length, 1);
  assert.equal(analysis.result.errors.length, 1);
});

test("englische Exporte mit Dezimalpunkt und US-Datum", () => {
  const csv = [
    "Date,Odometer,Trip,Quantity,Total price,Currency,Type,Note",
    "08/28/2026,12345.6,400,40.5,72.10,USD,full,",
    "09/02/2026,12800,454.4,30,51.00,USD,notfull,",
  ].join("\n");
  const analysis = analyzeCsv(Buffer.from(csv));
  assert.equal(analysis.options.dateFormat, "MM/DD/YYYY");
  assert.equal(analysis.options.decimalSeparator, ".");
  const [first, second] = analysis.result.entries;
  assert.equal(first.date, "2026-08-28");
  assert.equal(first.odometerMeters, 12345600);
  assert.equal(first.currency, "USD");
  assert.equal(first.fullTank, true);
  assert.equal(second.fullTank, false);
});

test("Elektroauto: Menge in kWh als Laden", () => {
  const analysis = analyzeCsv(Buffer.from(SPRITMONITOR_FUEL_DE), { energy: "charging_kwh" });
  const entry = analysis.result.entries[0];
  assert.equal(entry.category, "charging");
  assert.equal(entry.quantityUnit, "kwh");
  assert.equal(entry.fuelType, "electric");
});

test("meldet fallende Kilometerstände als Hinweis", () => {
  const csv = "Datum;Km-Stand;Spritmenge;Kosten\n01.01.2026;1000;40;70\n02.01.2026;900;40;70\n";
  const analysis = analyzeCsv(Buffer.from(csv));
  assert.equal(analysis.result.entries.length, 2);
  assert.ok(analysis.result.warnings.some((warning) => /kleiner/.test(warning.message)));
});

test("Hilfsfunktionen", () => {
  assert.equal(parseNumber("1.234,56", ","), 1234.56);
  assert.equal(parseNumber("1,234.56", "."), 1234.56);
  assert.equal(parseNumber("46,44 €", ","), 46.44);
  assert.equal(parseNumber("", ","), null);
  assert.ok(Number.isNaN(parseNumber("abc", ",")));
  assert.equal(parseDate("31.02.2026", "DD.MM.YYYY"), undefined);
  assert.equal(parseDate("1.3.26", "DD.MM.YYYY"), "2026-03-01");
  assert.equal(parseTankType("notfull").fullTank, false);
  assert.equal(parseTankType("Volltankung").fullTank, true);
  assert.equal(mapCostCategory("TÜV"), "inspection");
  assert.equal(mapCostCategory("Leasingrate Oktober"), "leasing");
  assert.equal(mapCostCategory("Parkhaus Mainz"), "parking");
  assert.equal(mapCostCategory("Kaffee"), "other");
});
