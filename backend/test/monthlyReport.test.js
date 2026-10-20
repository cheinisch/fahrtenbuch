import assert from "node:assert/strict";
import { test } from "node:test";

process.env.JWT_SECRET ||= "test-secret";
process.env.POSTGRES_PASSWORD ||= "test";

const { clusterDestinations, parseReportMonth, previousMonth } = await import("../src/services/monthlyReportService.js");
const { isReportDue } = await import("../src/services/monthlyReportDelivery.js");
const { renderMonthlyReportMail } = await import("../src/services/monthlyReportMail.js");

test("Vormonat in der Kontozeitzone", () => {
  // 01.10.2026 00:30 in Berlin ist in UTC noch der 30.09.
  const now = new Date("2026-09-30T22:30:00Z");
  assert.equal(previousMonth("Europe/Berlin", now), "2026-09");
  assert.equal(previousMonth("UTC", now), "2026-08");
  assert.equal(previousMonth("Europe/Berlin", new Date("2026-01-15T12:00:00Z")), "2025-12");
  assert.equal(parseReportMonth("2026-09", "UTC"), "2026-09");
  assert.throws(() => parseReportMonth("2026-13", "UTC"));
});

test("Versand ab 6 Uhr am Monatsersten, Nachholen bis zum 7.", () => {
  assert.equal(isReportDue("Europe/Berlin", new Date("2026-10-01T03:30:00Z")), false); // 05:30
  assert.equal(isReportDue("Europe/Berlin", new Date("2026-10-01T04:00:00Z")), true); // 06:00
  assert.equal(isReportDue("Europe/Berlin", new Date("2026-10-07T20:00:00Z")), true);
  assert.equal(isReportDue("Europe/Berlin", new Date("2026-10-08T08:00:00Z")), false);
});

test("Ziele im Radius werden zusammengefasst, Zuhause ignoriert", () => {
  const trips = [
    { end_lat: 50.0800, end_lon: 8.2400 },
    { end_lat: 50.0805, end_lon: 8.2402 }, // ~60 m daneben
    { end_lat: 50.1000, end_lon: 8.3000 },
    { end_lat: 49.9900, end_lon: 7.9500 }, // Zuhause
    { end_lat: null, end_lon: null },
  ];
  const clusters = clusterDestinations(trips, 250, [{ latitude: 49.9901, longitude: 7.9501 }]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].arrivals.length, 2);
});

test("Mail enthält offene Fahrten, Fahrzeuge und neue Orte", () => {
  const report = {
    month: "2026-09", from: "2026-09-01", to: "2026-09-30", timeZone: "Europe/Berlin", distanceUnit: "km",
    totals: { drivenKm: 2411, businessKm: 1494, tripCount: 89, openTripCount: 1, openKm: 16 },
    vehicles: [{
      id: "v1", name: "VW ID.4", licensePlate: "RÜD-CH 482", access: "owner", ownerName: null, tripCount: 67,
      openTripCount: 1, drivenKm: 1681, actualKm: 1681, trackedKm: 1627.6, businessKm: 1084, privateKm: 362.6,
      commuteKm: 139, unclassifiedKm: 42, otherDriversKm: 0, unexplainedKm: 53.4, endOdometerKm: 84131,
    }],
    openTrips: [{ id: "t1", vehicleName: "VW ID.4", localStart: "2026-09-12T15:20", localEnd: "2026-09-12T15:44", startAddress: "Zuhause", endAddress: "Wiesbaden <Test>", distanceKm: 16 }],
    olderOpenTripCount: 0,
    newPlaces: [{ key: "50.1,8.2", address: "Wiesbaden, Mainzer Str. 142", firstVisit: "2026-09-12", tripCount: 2, distanceKm: 30.8, openTripCount: 2, mainType: null, purpose: null, savedPlace: null }],
    isEmpty: false,
  };
  const mail = renderMonthlyReportMail(report, { name: "Christian Heinisch", language: "de", baseUrl: "https://fb.example.de" });
  assert.equal(mail.subject, "Dein Monatsbericht September 2026 · 1 Fahrzeug · 1 offene Fahrt");
  assert.match(mail.html, /Hallo Christian, dein September in Zahlen\./);
  assert.match(mail.html, /2\.411 km/);
  assert.match(mail.html, /Wiesbaden &lt;Test&gt;/);
  assert.match(mail.html, /beide noch offen/);
  assert.match(mail.html, /reports\/monthly\?month=2026-09&amp;place=50\.1%2C8\.2/);
  assert.match(mail.text, /1 Fahrt wartet auf eine Kategorie/);

  const english = renderMonthlyReportMail({ ...report, distanceUnit: "mi" }, { name: "", language: "en", baseUrl: "https://fb.example.de" });
  assert.match(english.subject, /^Your monthly report September 2026/);
  assert.match(english.html, /1,498 mi/);
});
