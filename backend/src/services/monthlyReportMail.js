// HTML-Mail und Textfassung des Monatsberichts. Aufbau wie im Mockup, aber
// mail-tauglich: Tabellen statt Flexbox, nur Inline-Styles, Logo als CID-Anhang.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const LOGO_CID = "fahrtenbuch-logo@mail";
export const LOGO_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/mail-logo.png");

const TEXT = {
  de: {
    locale: "de-DE",
    subject: "Dein Monatsbericht {month}",
    subjectVehicles: { one: "1 Fahrzeug", other: "{count} Fahrzeuge" },
    subjectOpen: { zero: "alles zugeordnet", one: "1 offene Fahrt", other: "{count} offene Fahrten" },
    preheader: "{driven} gefahren, davon {business} dienstlich.",
    greeting: "Hallo {name}, dein {monthName} in Zahlen.",
    greetingNoName: "Dein {monthName} in Zahlen.",
    period: "{from} – {to} · alle deine Fahrzeuge",
    driven: "Gefahren",
    business: "Davon dienstlich",
    trips: "Fahrten",
    openTitle: { one: "1 Fahrt wartet auf eine Kategorie", other: "{count} Fahrten warten auf eine Kategorie" },
    openText: "Zusammen {km}. Solange sie offen sind, fehlen sie im dienstlichen Anteil und der Monat lässt sich nicht abschließen.",
    openMore: { one: "… und 1 weitere Fahrt.", other: "… und {count} weitere Fahrten." },
    olderOpen: { one: "Dazu kommt 1 offene Fahrt aus früheren Monaten.", other: "Dazu kommen {count} offene Fahrten aus früheren Monaten." },
    assign: "Fahrten zuordnen",
    allAssigned: "Alle Fahrten sind zugeordnet.",
    vehiclesTitle: "Deine Fahrzeuge",
    sharedBy: "geteilt von {name}",
    shared: "geteilt",
    ownerMeta: { one: "1 Fahrt", other: "{count} Fahrten" },
    sharedMeta: { one: "nur deine 1 Fahrt", other: "nur deine {count} Fahrten" },
    odometer: "Stand {value}",
    vehicleOpen: "{count} offen",
    vehicleDone: "alles zugeordnet",
    catBusiness: "Dienstlich",
    catPrivate: "Privat",
    catCommute: "Arbeitsweg",
    catOpen: "offen",
    catOther: "andere Fahrer",
    catUnexplained: "ohne Fahrt",
    legendOpen: "Offen",
    legendOther: "Andere Fahrer",
    legendUnexplained: "Ohne Fahrt (laut Kilometerstand)",
    placesTitle: { one: "1 neuer Ort im {monthName}", other: "{count} neue Orte im {monthName}" },
    placesText: "Hier warst du im {monthName} zum ersten Mal – in den Monaten davor führte keine Fahrt dorthin. Speicherst du einen Ort, erscheint er mit Namen in der Fahrtenliste, und künftige Fahrten dorthin bekommen einen Vorschlag für Kategorie und Zweck.",
    firstVisit: "Erstmals am {date}",
    placeTrips: { one: "1 Fahrt", other: "{count} Fahrten" },
    placeOpenAll: { one: "noch offen", two: "beide noch offen", other: "alle noch offen" },
    placeOpenSome: "{count} noch offen",
    savePlace: "Ort speichern",
    saved: "✓ Gespeichert",
    openInBrowser: "Im Browser öffnen",
    footer: "Du erhältst diese E-Mail jeden Monatsersten, weil der Monatsbericht in deinem Profil aktiviert ist. Abbestellen: Profil › Benachrichtigungen. Gesendet von deinem Fahrtenbuch-Server {host}.",
    footerLink: "Profil › Benachrichtigungen",
    types: { business: "dienstlich", private: "privat", commute: "Arbeitsweg" },
    unknownPlace: "Unbekannte Adresse",
    unknownRoute: "Unbekannt",
  },
  en: {
    locale: "en-US",
    subject: "Your monthly report {month}",
    subjectVehicles: { one: "1 vehicle", other: "{count} vehicles" },
    subjectOpen: { zero: "all assigned", one: "1 open trip", other: "{count} open trips" },
    preheader: "{driven} driven, {business} of it for business.",
    greeting: "Hi {name}, here is your {monthName} in numbers.",
    greetingNoName: "Your {monthName} in numbers.",
    period: "{from} – {to} · all your vehicles",
    driven: "Driven",
    business: "For business",
    trips: "Trips",
    openTitle: { one: "1 trip is waiting for a category", other: "{count} trips are waiting for a category" },
    openText: "{km} in total. While they are open, they are missing from the business share and the month cannot be closed.",
    openMore: { one: "… and 1 more trip.", other: "… and {count} more trips." },
    olderOpen: { one: "Plus 1 open trip from earlier months.", other: "Plus {count} open trips from earlier months." },
    assign: "Assign trips",
    allAssigned: "All trips are assigned.",
    vehiclesTitle: "Your vehicles",
    sharedBy: "shared by {name}",
    shared: "shared",
    ownerMeta: { one: "1 trip", other: "{count} trips" },
    sharedMeta: { one: "only your 1 trip", other: "only your {count} trips" },
    odometer: "odometer {value}",
    vehicleOpen: "{count} open",
    vehicleDone: "all assigned",
    catBusiness: "Business",
    catPrivate: "Private",
    catCommute: "Commute",
    catOpen: "open",
    catOther: "other drivers",
    catUnexplained: "without trip",
    legendOpen: "Open",
    legendOther: "Other drivers",
    legendUnexplained: "Without trip (per odometer)",
    placesTitle: { one: "1 new place in {monthName}", other: "{count} new places in {monthName}" },
    placesText: "You went here for the first time in {monthName} – no trip led there in the months before. Save a place to see its name in the trip list and get a category and purpose suggestion for future trips there.",
    firstVisit: "First visit {date}",
    placeTrips: { one: "1 trip", other: "{count} trips" },
    placeOpenAll: { one: "still open", two: "both still open", other: "all still open" },
    placeOpenSome: "{count} still open",
    savePlace: "Save place",
    saved: "✓ Saved",
    openInBrowser: "Open in browser",
    footer: "You receive this e-mail on the first of every month because the monthly report is enabled in your profile. Unsubscribe: Profile › Notifications. Sent by your Fahrtenbuch server {host}.",
    footerLink: "Profile › Notifications",
    types: { business: "business", private: "private", commute: "commute" },
    unknownPlace: "Unknown address",
    unknownRoute: "Unknown",
  },
};

const COLORS = {
  business: "#0284c7",
  private: "#ea580c",
  commute: "#7c3aed",
  open: "#8a8a8a",
  other: "#0c4a6e",
  unexplained: "#c9c9c5",
};

const MI = 1.609344;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fill(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

function plural(forms, count, values = {}) {
  const form = count === 0 && forms.zero ? forms.zero
    : count === 1 ? forms.one
      : count === 2 && forms.two ? forms.two
        : forms.other;
  return fill(form, { count, ...values });
}

export function mailLanguage(language) {
  return TEXT[language] ? language : "de";
}

/** Formatierer für eine Sprache und Einheit; Werte kommen immer in km. */
export function formatters(language, unit = "km") {
  const t = TEXT[mailLanguage(language)];
  const factor = unit === "mi" ? 1 / MI : 1;
  const number = (value, digits = 0) => new Intl.NumberFormat(t.locale, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(value);
  const dateOnly = (iso, options) => new Intl.DateTimeFormat(t.locale, { ...options, timeZone: "UTC" })
    .format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
  return {
    t,
    distance: (km, digits = 0) => `${number(km * factor, digits)} ${unit}`,
    number,
    distanceNumber: (km) => number(km * factor, 0),
    unit,
    monthName: (month) => dateOnly(`${month}-01`, { month: "long" }),
    monthYear: (month) => dateOnly(`${month}-01`, { month: "long", year: "numeric" }),
    dayMonth: (iso) => dateOnly(iso, { day: "2-digit", month: "2-digit" }),
    dayMonthYear: (iso) => dateOnly(iso, { day: "2-digit", month: "2-digit", year: "numeric" }),
    weekdayDay: (iso) => dateOnly(iso, { weekday: "short", day: "2-digit", month: "2-digit" }),
    time: (iso) => (iso ? iso.slice(11, 16) : ""),
  };
}

/** Links in die Web-App. */
export function reportLinks(baseUrl, month) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const page = `${base}/reports/monthly?month=${encodeURIComponent(month)}`;
  return {
    page,
    assign: `${page}#open-trips`,
    place: (key) => `${page}&place=${encodeURIComponent(key)}#new-places`,
    trip: (id) => `${base}/?trip=${encodeURIComponent(id)}`,
    profile: `${base}/profilesettings#section-notifications`,
  };
}

function placeDetails(place, f) {
  const { t } = f;
  const parts = [
    fill(t.firstVisit, { date: f.dayMonth(place.firstVisit) }),
    plural(t.placeTrips, place.tripCount),
    f.distance(place.distanceKm, 1),
  ];
  if (place.openTripCount > 0 && place.openTripCount === place.tripCount) {
    parts.push(plural(t.placeOpenAll, place.tripCount));
  } else if (place.openTripCount > 0) {
    parts.push(fill(t.placeOpenSome, { count: place.openTripCount }));
  } else if (place.mainType) {
    parts.push([t.types[place.mainType] || place.mainType, place.purpose].filter(Boolean).join(", "));
  }
  return parts.join(" · ");
}

function vehicleSegments(vehicle) {
  const segments = [
    ["business", vehicle.businessKm],
    ["private", vehicle.privateKm],
    ["commute", vehicle.commuteKm],
    ["open", vehicle.unclassifiedKm],
    ["other", vehicle.otherDriversKm],
    ["unexplained", vehicle.unexplainedKm || 0],
  ].filter(([, value]) => value > 0.05);
  const total = segments.reduce((sum, [, value]) => sum + value, 0);
  return { segments, total };
}

function vehicleBreakdown(vehicle, f) {
  const { t } = f;
  const labels = {
    business: t.catBusiness, private: t.catPrivate, commute: t.catCommute,
    open: t.catOpen, other: t.catOther, unexplained: t.catUnexplained,
  };
  const { segments } = vehicleSegments(vehicle);
  if (!segments.length) return "";
  return `${segments.map(([key, value]) => `${labels[key]} ${f.distanceNumber(value)}`).join(" · ")} ${f.unit}`;
}

/** Betreff, HTML und Text des Berichts. `user`: { name, language }. */
export function renderMonthlyReportMail(report, { name, language, baseUrl }) {
  const f = formatters(language, report.distanceUnit);
  const { t } = f;
  const links = reportLinks(baseUrl, report.month);
  const host = String(baseUrl || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const monthName = f.monthName(report.month);
  const monthYear = f.monthYear(report.month);
  const firstName = String(name || "").trim().split(/\s+/)[0] || "";
  const { totals } = report;

  const subject = [
    fill(t.subject, { month: monthYear }),
    plural(t.subjectVehicles, report.vehicles.length),
    plural(t.subjectOpen, totals.openTripCount),
  ].join(" · ");
  const preheader = fill(t.preheader, { driven: f.distance(totals.drivenKm), business: f.distance(totals.businessKm) });
  const greeting = firstName ? fill(t.greeting, { name: firstName, monthName }) : fill(t.greetingNoName, { monthName });
  const period = fill(t.period, { from: f.dayMonth(report.from), to: f.dayMonthYear(report.to) });

  const font = "font-family: Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;";
  const button = (href, label, primary) => `<a href="${escapeHtml(href)}" style="${font} display: inline-block; padding: 12px 20px; border-radius: 10px; font-size: 15px; font-weight: 600; text-decoration: none; ${primary ? "background: #0284c7; color: #ffffff; border: 1px solid #0284c7;" : "background: #ffffff; color: #1d1d1d; border: 1px solid #dededb;"}">${escapeHtml(label)}</a>`;
  const swatch = (color) => `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: ${color}; margin-right: 6px; vertical-align: middle;"></span>`;

  const kpi = (label, value) => `
      <td width="33%" style="padding: 0 5px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #0e5c86; border-radius: 10px;">
          <tr><td style="padding: 12px 14px; ${font}">
            <div style="font-size: 12px; color: #bae6fd;">${escapeHtml(label)}</div>
            <div style="font-size: 20px; font-weight: 700; color: #f0f9ff;">${escapeHtml(value)}</div>
          </td></tr>
        </table>
      </td>`;

  // Offene Fahrten
  let openHtml = "";
  if (totals.openTripCount > 0) {
    const rows = report.openTrips.map((trip, index) => `
          <tr>
            <td style="padding: 8px 10px; ${font} font-size: 13px; color: #1d1d1d; white-space: nowrap; vertical-align: top;${index ? " border-top: 1px solid #f3e3b5;" : ""}">${escapeHtml(f.weekdayDay(trip.localStart))}</td>
            <td style="padding: 8px 10px; ${font} font-size: 13px; color: #1d1d1d;${index ? " border-top: 1px solid #f3e3b5;" : ""}">
              <a href="${escapeHtml(links.trip(trip.id))}" style="color: #1d1d1d; text-decoration: none; font-weight: 500;">${escapeHtml(trip.startAddress || t.unknownRoute)} → ${escapeHtml(trip.endAddress || t.unknownRoute)}</a>
              <div style="font-size: 12px; color: #555555;">${escapeHtml(trip.vehicleName)} · ${escapeHtml(f.time(trip.localStart))}–${escapeHtml(f.time(trip.localEnd))}</div>
            </td>
            <td style="padding: 8px 10px; ${font} font-size: 13px; color: #1d1d1d; text-align: right; white-space: nowrap; vertical-align: top;${index ? " border-top: 1px solid #f3e3b5;" : ""}">${escapeHtml(f.distance(trip.distanceKm, 1))}</td>
          </tr>`).join("");
    const more = totals.openTripCount - report.openTrips.length;
    openHtml = `
      <tr><td style="padding: 0 0 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #fef3c7; border-radius: 12px;">
          <tr><td style="padding: 18px; ${font} color: #92400e;">
            <div style="font-size: 16px; font-weight: 700;">${escapeHtml(plural(t.openTitle, totals.openTripCount))}</div>
            <div style="font-size: 14px; line-height: 1.5; padding-top: 4px;">${escapeHtml(fill(t.openText, { km: f.distance(totals.openKm) }))}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 8px; margin-top: 12px;">${rows}
            </table>
            ${more > 0 ? `<div style="font-size: 13px; padding-top: 8px;">${escapeHtml(plural(t.openMore, more))}</div>` : ""}
            ${report.olderOpenTripCount > 0 ? `<div style="font-size: 13px; padding-top: 8px;">${escapeHtml(plural(t.olderOpen, report.olderOpenTripCount))}</div>` : ""}
            <div style="padding-top: 14px;">${button(links.assign, t.assign, true)}</div>
          </td></tr>
        </table>
      </td></tr>`;
  } else {
    openHtml = `
      <tr><td style="padding: 0 0 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #e0f2fe; border-radius: 12px;">
          <tr><td style="padding: 14px 18px; ${font} color: #0369a1; font-size: 15px; font-weight: 600;">${escapeHtml(t.allAssigned)}${report.olderOpenTripCount > 0 ? ` <span style="font-weight: 400;">${escapeHtml(plural(t.olderOpen, report.olderOpenTripCount))}</span>` : ""}</td></tr>
        </table>
      </td></tr>`;
  }

  // Fahrzeuge
  const usedKeys = new Set();
  const vehicleCards = report.vehicles.map((vehicle) => {
    const { segments, total } = vehicleSegments(vehicle);
    segments.forEach(([key]) => usedKeys.add(key));
    const bar = segments.length
      ? segments.map(([key, value]) => `<td width="${Math.max(1, Math.round(value / total * 1000) / 10)}%" style="background: ${COLORS[key]}; height: 10px; line-height: 10px; font-size: 0;">&nbsp;</td>`).join("")
      : `<td style="background: #ededeb; height: 10px; line-height: 10px; font-size: 0;">&nbsp;</td>`;
    const owner = vehicle.access === "owner";
    const meta = [vehicle.licensePlate, owner ? plural(t.ownerMeta, vehicle.tripCount) : plural(t.sharedMeta, vehicle.tripCount)];
    if (owner && vehicle.endOdometerKm != null) meta.push(fill(t.odometer, { value: f.distance(vehicle.endOdometerKm) }));
    const badge = owner ? "" : ` <span style="font-size: 12px; font-weight: 600; color: #0369a1; background: #e0f2fe; border-radius: 999px; padding: 2px 8px;">${escapeHtml(vehicle.ownerName ? fill(t.sharedBy, { name: vehicle.ownerName }) : t.shared)}</span>`;
    const status = vehicle.openTripCount > 0
      ? `<div style="font-size: 12px; color: #92400e; font-weight: 600;">${escapeHtml(fill(t.vehicleOpen, { count: vehicle.openTripCount }))}</div>`
      : `<div style="font-size: 12px; color: #555555;">${escapeHtml(t.vehicleDone)}</div>`;
    return `
        <tr><td style="padding: 0 0 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #dededb; border-radius: 12px;">
            <tr><td style="padding: 16px 18px; ${font}">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="${font} vertical-align: top;">
                    <div style="font-weight: 700; font-size: 15px; color: #1d1d1d;">${escapeHtml(vehicle.name)}${badge}</div>
                    <div style="font-size: 13px; color: #555555;">${escapeHtml(meta.filter(Boolean).join(" · "))}</div>
                  </td>
                  <td style="${font} text-align: right; vertical-align: top; white-space: nowrap;">
                    <div style="font-weight: 700; font-size: 18px; color: #1d1d1d;">${escapeHtml(f.distance(vehicle.drivenKm))}</div>
                    ${status}
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 10px; border-radius: 5px; overflow: hidden;"><tr>${bar}</tr></table>
              <div style="font-size: 13px; color: #555555; line-height: 1.5; padding-top: 10px;">${escapeHtml(vehicleBreakdown(vehicle, f))}</div>
            </td></tr>
          </table>
        </td></tr>`;
  }).join("");
  const legendLabels = {
    business: t.catBusiness, private: t.catPrivate, commute: t.catCommute,
    open: t.legendOpen, other: t.legendOther, unexplained: t.legendUnexplained,
  };
  const legend = Object.keys(legendLabels).filter((key) => usedKeys.has(key))
    .map((key) => `<span style="display: inline-block; margin: 0 16px 6px 0; white-space: nowrap;">${swatch(COLORS[key])}${escapeHtml(legendLabels[key])}</span>`).join("");
  const vehiclesHtml = report.vehicles.length ? `
      <tr><td style="padding: 0 0 14px; ${font} font-size: 18px; font-weight: 700; color: #1d1d1d;">${escapeHtml(t.vehiclesTitle)}</td></tr>
      ${vehicleCards}
      <tr><td style="padding: 0 0 28px; ${font} font-size: 12px; color: #555555;">${legend}</td></tr>` : "";

  // Neue Orte
  const placesHtml = report.newPlaces.length ? `
      <tr><td style="padding: 0 0 4px; ${font} font-size: 18px; font-weight: 700; color: #1d1d1d;">${escapeHtml(plural(t.placesTitle, report.newPlaces.length, { monthName }))}</td></tr>
      <tr><td style="padding: 0 0 14px; ${font} font-size: 14px; color: #555555; line-height: 1.5;">${escapeHtml(fill(t.placesText, { monthName }))}</td></tr>
      <tr><td style="padding: 0 0 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #dededb; border-radius: 12px;">
          ${report.newPlaces.map((place, index) => `
          <tr>
            <td width="34" style="padding: 14px 0 14px 16px; vertical-align: middle;${index ? " border-top: 1px solid #ededeb;" : ""}">
              <div style="width: 14px; height: 14px; border-radius: 50% 50% 50% 0; border: 2px solid #0369a1; transform: rotate(-45deg);"></div>
            </td>
            <td style="padding: 14px 10px; ${font}${index ? " border-top: 1px solid #ededeb;" : ""}">
              <div style="font-weight: 600; font-size: 14px; color: #1d1d1d;">${escapeHtml(place.address || t.unknownPlace)}${place.savedPlace ? ` <span style="font-weight: 400; color: #555555;">· „${escapeHtml(place.savedPlace.name)}“</span>` : ""}</div>
              <div style="font-size: 12px; color: #555555;">${escapeHtml(placeDetails(place, f))}</div>
            </td>
            <td style="padding: 14px 16px 14px 0; ${font} text-align: right; white-space: nowrap;${index ? " border-top: 1px solid #ededeb;" : ""}">
              ${place.savedPlace
                ? `<span style="font-size: 13px; font-weight: 600; color: #555555;">${escapeHtml(t.saved)}</span>`
                : `<a href="${escapeHtml(links.place(place.key))}" style="display: inline-block; padding: 9px 14px; border-radius: 8px; border: 1px solid #0284c7; color: #0369a1; font-weight: 600; font-size: 13px; text-decoration: none;">${escapeHtml(t.savePlace)}</a>`}
            </td>
          </tr>`).join("")}
        </table>
      </td></tr>` : "";

  const footer = escapeHtml(fill(t.footer, { host })).replace(
    escapeHtml(t.footerLink),
    `<a href="${escapeHtml(links.profile)}" style="color: #0369a1;">${escapeHtml(t.footerLink)}</a>`,
  );

  const html = `<!doctype html>
<html lang="${mailLanguage(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background: #f7f7f5;">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f7f7f5;">
  <tr><td align="center" style="padding: 24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">
      <tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #ffffff; border: 1px solid #dededb; border-radius: 14px; overflow: hidden;">
          <tr><td style="background: #0c4a6e; padding: 24px 28px; ${font}">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="padding-right: 10px; vertical-align: middle;"><img src="cid:${LOGO_CID}" width="30" height="30" alt="" style="display: block; border-radius: 8px;"></td>
              <td style="${font} font-weight: 700; font-size: 16px; color: #f0f9ff; vertical-align: middle;">Fahrtenbuch</td>
            </tr></table>
            <div style="font-size: 24px; font-weight: 700; line-height: 1.25; color: #f0f9ff; padding-top: 18px;">${escapeHtml(greeting)}</div>
            <div style="font-size: 14px; color: #bae6fd; padding-top: 4px;">${escapeHtml(period)}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 18px;"><tr>
              ${kpi(t.driven, f.distance(totals.drivenKm))}
              ${kpi(t.business, f.distance(totals.businessKm))}
              ${kpi(t.trips, f.number(totals.tripCount))}
            </tr></table>
          </td></tr>
          <tr><td style="padding: 24px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${openHtml}
              ${vehiclesHtml}
              ${placesHtml}
              <tr><td>${button(links.page, t.openInBrowser, false)}</td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding: 16px 4px 0; ${font} font-size: 12px; line-height: 1.5; color: #555555;">${footer}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // Textfassung für Clients ohne HTML
  const lines = [greeting, period, "", `${t.driven}: ${f.distance(totals.drivenKm)} · ${t.business}: ${f.distance(totals.businessKm)} · ${t.trips}: ${totals.tripCount}`, ""];
  if (totals.openTripCount > 0) {
    lines.push(plural(t.openTitle, totals.openTripCount), fill(t.openText, { km: f.distance(totals.openKm) }));
    report.openTrips.forEach((trip) => lines.push(`- ${f.weekdayDay(trip.localStart)} ${trip.startAddress || t.unknownRoute} → ${trip.endAddress || t.unknownRoute} (${trip.vehicleName}, ${f.distance(trip.distanceKm, 1)})`));
    if (report.olderOpenTripCount > 0) lines.push(plural(t.olderOpen, report.olderOpenTripCount));
    lines.push(`${t.assign}: ${links.assign}`, "");
  } else {
    lines.push(t.allAssigned, "");
  }
  if (report.vehicles.length) {
    lines.push(t.vehiclesTitle);
    report.vehicles.forEach((vehicle) => lines.push(`- ${vehicle.name}${vehicle.licensePlate ? ` (${vehicle.licensePlate})` : ""}: ${f.distance(vehicle.drivenKm)} – ${vehicleBreakdown(vehicle, f)}`));
    lines.push("");
  }
  if (report.newPlaces.length) {
    lines.push(plural(t.placesTitle, report.newPlaces.length, { monthName }));
    report.newPlaces.forEach((place) => lines.push(`- ${place.address || t.unknownPlace}: ${placeDetails(place, f)}${place.savedPlace ? "" : ` – ${links.place(place.key)}`}`));
    lines.push("");
  }
  lines.push(`${t.openInBrowser}: ${links.page}`, "", fill(t.footer, { host }), links.profile);

  return { subject, html, text: lines.join("\n") };
}
