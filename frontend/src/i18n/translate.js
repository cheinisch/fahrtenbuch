import { parse as parseJsonc } from "jsonc-parser";
import deJson from "./locales/de/translation.json?raw";
import enJson from "./locales/en/translation.json?raw";

// Übersetzungsdateien sind JSONC (Kommentare erlaubt) – daher ?raw + jsonc-parser
// statt Vites JSON-Import.
function loadJsonc(source, file) {
  const errors = [];
  const data = parseJsonc(source, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`Invalid translation file ${file} (offset ${errors[0].offset})`);
  return data;
}

export const dictionaries = {
  de: loadJsonc(deJson, "de/translation.json"),
  en: loadJsonc(enJson, "en/translation.json"),
};

let activeLanguage = "de";
export function setActiveLanguage(language) {
  activeLanguage = dictionaries[language] ? language : "de";
}

function read(obj, key) {
  return key.split(".").reduce((value, part) => value?.[part], obj);
}

export function translateIn(language, key, paramsOrFallback, fallback) {
  const params = paramsOrFallback && typeof paramsOrFallback === "object" ? paramsOrFallback : {};
  const fb = typeof paramsOrFallback === "string" ? paramsOrFallback : fallback;
  const template = read(dictionaries[language], key) ?? read(dictionaries.de, key) ?? fb ?? key;
  return typeof template === "string"
    ? template.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`)
    : template;
}

// Für Code außerhalb von React (api/, lib/): nutzt die vom I18nProvider gesetzte Sprache.
export function translate(key, paramsOrFallback, fallback) {
  return translateIn(activeLanguage, key, paramsOrFallback, fallback);
}

// Server-Codes (OAUTH_NOT_LINKED) und DB-Felder (vehicle_id) als camelCase-Key-Segment.
export function codeKey(code) {
  const parts = String(code || "").toLowerCase().split("_").filter(Boolean);
  return parts.map((part, index) => (index ? part[0].toUpperCase() + part.slice(1) : part)).join("");
}
