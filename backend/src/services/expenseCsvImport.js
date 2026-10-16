import { parse as parseCsv } from "csv-parse/sync";

// CSV-Import für Fahrzeugkosten. Primär für Spritmonitor-Exporte (Tankungen und
// Kosten/Notizen, deutsch oder englisch), funktioniert aber mit jeder CSV, deren
// Spalten sich zuordnen lassen. Reine Funktionen ohne Datenbank, damit testbar.

export const IMPORT_FIELDS = Object.freeze([
  "date", "odometer", "quantity", "amount", "currency", "tankType",
  "costType", "title", "note", "vendor", "fuel",
]);

// Kopfzeilen (klein geschrieben, ohne Sonderzeichen) → Feld
const HEADER_SYNONYMS = {
  date: ["datum", "date", "tankdatum", "day"],
  odometer: ["kmstand", "kilometerstand", "odometer", "mileage", "tachostand", "milesodometer"],
  quantity: ["spritmenge", "menge", "quantity", "liter", "litres", "liters", "volume", "kwh", "fuelquantity"],
  amount: ["kosten", "betrag", "preis", "gesamtpreis", "totalprice", "price", "cost", "costs", "total", "amount", "summe"],
  currency: ["wahrung", "waehrung", "currency"],
  tankType: ["tankart", "tanktype", "type", "fillingtype", "fulltank", "vollgetankt"],
  costType: ["kostenart", "costtype", "kategorie", "category", "art"],
  title: ["bezeichnung", "titel", "title", "name", "beschreibung", "description"],
  note: ["bemerkung", "notiz", "notizen", "note", "notes", "comment", "kommentar"],
  vendor: ["tankstelle", "gasstation", "station", "werkstatt", "anbieter", "vendor", "location"],
  fuel: ["kraftstoff", "fuel", "fuelsort", "sorte"],
};

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

/** Dekodiert UTF-8 (mit/ohne BOM) und fällt bei ungültigen Bytes auf Windows-1252 zurück. */
export function decodeCsvBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = [";", ",", "\t"].map((delimiter) => [delimiter, firstLine.split(delimiter).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ";";
}

export function readCsv(text) {
  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, {
    delimiter,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  });
  if (records.length === 0) {
    return { delimiter, headers: [], rows: [] };
  }
  const [headers, ...rows] = records;
  return { delimiter, headers: headers.map((header) => String(header || "").trim()), rows };
}

/** Schlägt je Feld die passende Spalte vor (Index) und erkennt den Dateityp. */
export function suggestMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  for (const field of IMPORT_FIELDS) {
    const synonyms = HEADER_SYNONYMS[field];
    // Exakte Treffer zuerst, damit z. B. „Kosten“ nicht „Kostenart“ verdrängt
    let index = normalized.findIndex((header) => synonyms.includes(header));
    if (index < 0) {
      index = normalized.findIndex((header) => synonyms.some((synonym) => synonym.length > 3 && header.startsWith(synonym)));
    }
    if (index >= 0 && !Object.values(mapping).includes(index)) {
      mapping[field] = index;
    }
  }

  const hasCostColumns = mapping.costType != null || mapping.title != null;
  const kind = mapping.quantity != null && !hasCostColumns ? "fuel" : hasCostColumns && mapping.quantity == null ? "costs" : "fuel";
  const isSpritmonitor = normalized.includes("kmstand") && (normalized.includes("teilkm") || normalized.includes("kostenart"))
    || (normalized.includes("odometer") && (normalized.includes("trip") || normalized.includes("costtype")) && normalized.includes("currency"));

  return { mapping, kind, source: isSpritmonitor ? "spritmonitor" : "generic" };
}

/** Erkennt Datums- und Zahlenformat anhand der Werte. */
export function detectFormats(rows, mapping) {
  const dates = mapping.date == null ? [] : rows.map((row) => String(row[mapping.date] || "")).filter(Boolean).slice(0, 200);
  let dateFormat = "DD.MM.YYYY";
  if (dates.some((value) => /^\d{4}-\d{2}-\d{2}/.test(value))) dateFormat = "YYYY-MM-DD";
  else if (dates.some((value) => /^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(value))) dateFormat = "DD.MM.YYYY";
  else if (dates.some((value) => /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value))) {
    // Erster Teil > 12 → Tag zuerst; zweiter Teil > 12 → Monat zuerst
    const dayFirst = dates.some((value) => Number(value.split("/")[0]) > 12);
    const monthFirst = dates.some((value) => Number(value.split("/")[1]) > 12);
    dateFormat = monthFirst && !dayFirst ? "MM/DD/YYYY" : "DD/MM/YYYY";
  }

  const numericColumns = ["quantity", "amount", "odometer"].map((field) => mapping[field]).filter((index) => index != null);
  let comma = 0;
  let dot = 0;
  for (const row of rows.slice(0, 200)) {
    for (const index of numericColumns) {
      const value = String(row[index] || "");
      if (/\d,\d{1,2}$/.test(value) || /\d\.\d{3},\d/.test(value)) comma += 1;
      if (/\d\.\d{1,2}$/.test(value) || /\d,\d{3}\.\d/.test(value)) dot += 1;
    }
  }
  return { dateFormat, decimalSeparator: dot > comma ? "." : "," };
}

export function parseNumber(raw, decimalSeparator = ",") {
  let value = String(raw ?? "").trim().replace(/[\s €$£]/g, "").replace(/(\d)[A-Za-z]+$/, "$1");
  if (!value) return null;
  if (decimalSeparator === ",") value = value.replace(/\./g, "").replace(",", ".");
  else value = value.replace(/,/g, "");
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

export function parseDate(raw, dateFormat) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  let year;
  let month;
  let day;
  let match;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value))) {
    [, year, month, day] = match;
  } else if ((match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(value))) {
    const [, first, second, y] = match;
    year = y.length === 2 ? `20${y}` : y;
    if (dateFormat === "MM/DD/YYYY") [month, day] = [first, second];
    else [day, month] = [first, second];
  } else {
    return undefined;
  }
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso) return undefined;
  return iso;
}

/**
 * Tankart: Spritmonitor exportiert sie als Zahl (1 = voll, 2 = teil, 3 = erste Tankung,
 * 4 = ungültig) oder als Text (full, notfull, first, invalid).
 * „Erste Tankung“ ist eine Volltankung ohne Vorgänger und setzt den Startpunkt der Messung.
 */
export function parseTankType(raw) {
  const value = normalizeHeader(raw);
  if (!value) return { fullTank: false, recognized: false };
  if (["1", "full", "voll", "volltankung", "ja", "yes", "true", "x", "3", "first", "erste", "erstetankung", "erstbetankung"].includes(value)) {
    return { fullTank: true, recognized: true, first: value === "3" || value.startsWith("first") || value.startsWith("erst") };
  }
  if (["2", "notfull", "teil", "teiltankung", "partial", "nein", "no", "false", "0", "4", "invalid", "ungultig"].includes(value)) {
    return { fullTank: false, recognized: true, invalid: value === "4" || value === "invalid" || value === "ungultig" };
  }
  return { fullTank: false, recognized: false };
}

// Spritmonitor-Kostenarten und übliche Bezeichnungen → eigene Kategorien
const COST_KEYWORDS = [
  ["insurance", ["versicherung", "insurance", "haftpflicht", "kasko"]],
  ["tax", ["steuer", "tax"]],
  ["inspection", ["tuv", "tuev", "hu", "au", "hauptuntersuchung", "abgasuntersuchung", "inspection", "mot", "dekra", "gtu"]],
  ["tires", ["reifen", "tire", "tyre", "rader", "raeder", "felge"]],
  ["maintenance", ["wartung", "service", "inspektion", "olwechsel", "oelwechsel", "oil", "maintenance", "kundendienst"]],
  ["repair", ["reparatur", "repair", "werkstatt", "garage", "defekt"]],
  ["leasing", ["leasing", "lease"]],
  ["financing", ["finanzierung", "kredit", "rate", "financing", "loan"]],
  ["parking", ["parken", "parking", "parkhaus", "parkgebuhr", "parkticket"]],
  ["toll", ["maut", "toll", "vignette", "fahre", "faehre", "ferry", "tunnel"]],
  ["cleaning", ["wasche", "waesche", "pflege", "reinigung", "wash", "cleaning", "care", "waschanlage"]],
  ["charging", ["laden", "ladestrom", "charging", "strom", "wallbox"]],
  ["fuel", ["tanken", "kraftstoff", "benzin", "diesel", "adblue"]],
];

export function mapCostCategory(...texts) {
  const words = texts
    .filter(Boolean)
    .flatMap((text) => String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/))
    .filter(Boolean);
  for (const [category, keywords] of COST_KEYWORDS) {
    if (words.some((word) => keywords.some((keyword) => word === keyword || (keyword.length > 4 && word.startsWith(keyword))))) {
      return category;
    }
  }
  return "other";
}

const CURRENCY_ALIASES = { "€": "EUR", EURO: "EUR", "$": "USD", "£": "GBP", YEN: "JPY", SFR: "CHF", FR: "CHF" };

function parseCurrency(raw, fallback) {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!value) return fallback;
  if (CURRENCY_ALIASES[value]) return CURRENCY_ALIASES[value];
  return /^[A-Z]{3}$/.test(value) ? value : fallback;
}

/**
 * Wandelt die CSV-Zeilen in Kosteneinträge um.
 * options: { kind: "fuel"|"costs", energy: "fuel_l"|"fuel_kg"|"charging_kwh", dateFormat, decimalSeparator, currency }
 * Liefert { entries, errors, warnings } – fehlerhafte Zeilen werden übersprungen, nicht abgebrochen.
 */
export function normalizeRows(rows, mapping, options) {
  const entries = [];
  const errors = [];
  const warnings = [];
  const cell = (row, field) => (mapping[field] == null ? "" : String(row[mapping[field]] ?? "").trim());
  const energy = options.energy || "fuel_l";
  const unrecognizedTankTypes = new Set();

  rows.forEach((row, index) => {
    const line = index + 2;
    if (row.every((value) => !String(value ?? "").trim())) return;

    const date = parseDate(cell(row, "date"), options.dateFormat);
    if (!date) {
      errors.push({ line, message: date === null ? "Datum fehlt." : `Ungültiges Datum „${cell(row, "date")}“.` });
      return;
    }

    const amount = parseNumber(cell(row, "amount"), options.decimalSeparator);
    if (Number.isNaN(amount) || amount < 0) {
      errors.push({ line, message: `Ungültiger Betrag „${cell(row, "amount")}“.` });
      return;
    }

    const odometerKm = parseNumber(cell(row, "odometer"), options.decimalSeparator);
    if (Number.isNaN(odometerKm) || (odometerKm != null && odometerKm < 0)) {
      errors.push({ line, message: `Ungültiger Kilometerstand „${cell(row, "odometer")}“.` });
      return;
    }

    const note = cell(row, "note") || null;
    const vendor = cell(row, "vendor") || null;
    const currency = parseCurrency(cell(row, "currency"), options.currency || "EUR");

    if (options.kind === "costs") {
      const costType = cell(row, "costType");
      const title = cell(row, "title");
      if (amount == null || amount === 0) {
        // Spritmonitor exportiert reine Notizen ohne Betrag – die gehören nicht in die Kosten
        if (title || note || costType) warnings.push({ line, message: "Notiz ohne Betrag übersprungen." });
        else errors.push({ line, message: "Betrag fehlt." });
        return;
      }
      const category = mapCostCategory(costType, title);
      const notes = [costType && category === "other" ? costType : null, title, note].filter(Boolean).join(" – ") || null;
      entries.push({
        line, category, date, amountCents: Math.round(amount * 100), currency,
        odometerMeters: odometerKm == null ? null : Math.round(odometerKm * 1000),
        quantity: null, quantityUnit: null, fuelType: null, fullTank: false,
        vendor: vendor?.slice(0, 200) || null, notes: notes?.slice(0, 2000) || null,
      });
      return;
    }

    if (amount == null) {
      errors.push({ line, message: "Betrag fehlt." });
      return;
    }
    const quantity = parseNumber(cell(row, "quantity"), options.decimalSeparator);
    if (Number.isNaN(quantity) || (quantity != null && quantity <= 0)) {
      errors.push({ line, message: `Ungültige Menge „${cell(row, "quantity")}“.` });
      return;
    }
    const tank = parseTankType(cell(row, "tankType"));
    if (mapping.tankType != null && !tank.recognized && cell(row, "tankType")) {
      unrecognizedTankTypes.add(cell(row, "tankType"));
    }
    if (tank.invalid) {
      warnings.push({ line, message: "In Spritmonitor als ungültig markiert – als Teiltankung übernommen." });
    }

    const [category, unit] = energy === "charging_kwh" ? ["charging", "kwh"] : energy === "fuel_kg" ? ["fuel", "kg"] : ["fuel", "l"];
    entries.push({
      line, category, date, amountCents: Math.round(amount * 100), currency,
      odometerMeters: odometerKm == null ? null : Math.round(odometerKm * 1000),
      quantity: quantity == null ? null : Math.round(quantity * 1000) / 1000,
      quantityUnit: quantity == null ? null : unit,
      fuelType: category === "charging" ? "electric" : null,
      // Ohne Tankart-Spalte gilt jede Tankung als voll (häufigster Fall bei einfachen Exporten)
      fullTank: mapping.tankType == null ? true : tank.fullTank,
      vendor: vendor?.slice(0, 200) || null,
      notes: note?.slice(0, 2000) || null,
    });
  });

  if (unrecognizedTankTypes.size > 0) {
    warnings.push({ line: null, message: `Unbekannte Tankart-Werte als Teiltankung übernommen: ${[...unrecognizedTankTypes].slice(0, 5).join(", ")}` });
  }

  // Kilometerstände sollten mit dem Datum steigen – nur Hinweis, Import bleibt möglich
  const sorted = entries.filter((entry) => entry.odometerMeters != null).sort((a, b) => (a.date === b.date ? a.line - b.line : a.date < b.date ? -1 : 1));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].odometerMeters < sorted[index - 1].odometerMeters) {
      warnings.push({ line: sorted[index].line, message: `Kilometerstand ${sorted[index].odometerMeters / 1000} km ist kleiner als der vorherige (${sorted[index - 1].odometerMeters / 1000} km).` });
    }
  }

  return { entries, errors, warnings };
}

/** Kompletter Ablauf: Datei → Vorschlag/Optionen → Einträge. */
export function analyzeCsv(buffer, overrides = {}) {
  const { text, encoding } = decodeCsvBuffer(buffer);
  const { delimiter, headers, rows } = readCsv(text);
  if (headers.length === 0) {
    return { encoding, delimiter, headers, rows: [], suggestion: { mapping: {}, kind: "fuel", source: "generic" }, options: {}, mapping: {}, result: { entries: [], errors: [], warnings: [] } };
  }
  const suggestion = suggestMapping(headers);
  const mapping = overrides.mapping ? sanitizeMapping(overrides.mapping, headers.length) : suggestion.mapping;
  const detected = detectFormats(rows, mapping);
  const options = {
    kind: overrides.kind || suggestion.kind,
    energy: overrides.energy || "fuel_l",
    dateFormat: overrides.dateFormat || detected.dateFormat,
    decimalSeparator: overrides.decimalSeparator || detected.decimalSeparator,
    currency: overrides.currency || "EUR",
  };
  return { encoding, delimiter, headers, rows, suggestion, options, mapping, result: normalizeRows(rows, mapping, options) };
}

function sanitizeMapping(mapping, columnCount) {
  const clean = {};
  for (const field of IMPORT_FIELDS) {
    const value = mapping[field];
    if (value === null || value === undefined || value === "") continue;
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < columnCount) clean[field] = index;
  }
  return clean;
}
