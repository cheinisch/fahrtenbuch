import { badRequest } from "./errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function objectBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("VALIDATION_ERROR", "Der Request-Body muss ein JSON-Objekt sein.");
  }

  return value;
}

export function stringField(
  object,
  name,
  {
    required = false,
    nullable = false,
    minimum = 0,
    maximum = 10_000,
    trim = true,
  } = {},
) {
  const value = object?.[name];

  if (value === undefined) {
    if (required) {
      throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ ist erforderlich.`);
    }

    return undefined;
  }

  if (value === null) {
    if (nullable) {
      return null;
    }

    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ darf nicht null sein.`);
  }

  if (typeof value !== "string") {
    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ muss eine Zeichenkette sein.`);
  }

  const normalized = trim ? value.trim() : value;

  if (normalized.length < minimum || normalized.length > maximum) {
    throw badRequest(
      "VALIDATION_ERROR",
      `Das Feld „${name}“ muss zwischen ${minimum} und ${maximum} Zeichen lang sein.`,
    );
  }

  return normalized;
}

export function emailField(object, name = "email", required = false) {
  const value = stringField(object, name, {
    required,
    minimum: required ? 3 : 0,
    maximum: 320,
  });

  if (value === undefined || value === null) {
    return value;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw badRequest("VALIDATION_ERROR", "Bitte gib eine gültige E-Mail-Adresse ein.");
  }

  return value.toLowerCase();
}

export function numberField(
  object,
  name,
  {
    required = false,
    nullable = false,
    minimum = -Infinity,
    maximum = Infinity,
  } = {},
) {
  const raw = object?.[name];

  if (raw === undefined) {
    if (required) {
      throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ ist erforderlich.`);
    }

    return undefined;
  }

  if (raw === null || raw === "") {
    if (nullable) {
      return null;
    }

    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ darf nicht leer sein.`);
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw badRequest(
      "VALIDATION_ERROR",
      `Das Feld „${name}“ muss zwischen ${minimum} und ${maximum} liegen.`,
    );
  }

  return value;
}

export function integerField(object, name, options = {}) {
  const value = numberField(object, name, options);

  if (value === undefined || value === null) {
    return value;
  }

  if (!Number.isInteger(value)) {
    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ muss eine ganze Zahl sein.`);
  }

  return value;
}

export function booleanField(object, name, { required = false } = {}) {
  const value = object?.[name];

  if (value === undefined) {
    if (required) {
      throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ ist erforderlich.`);
    }

    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "1" || value === 1) {
    return true;
  }

  if (value === "false" || value === "0" || value === 0) {
    return false;
  }

  throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ muss true oder false sein.`);
}

export function enumField(
  object,
  name,
  allowed,
  { required = false, nullable = false } = {},
) {
  const value = stringField(object, name, {
    required,
    nullable,
    maximum: 120,
  });

  if (value === undefined || value === null) {
    return value;
  }

  if (!allowed.includes(value)) {
    throw badRequest(
      "VALIDATION_ERROR",
      `Das Feld „${name}“ enthält einen ungültigen Wert.`,
      { allowed },
    );
  }

  return value;
}

export function uuidValue(value, name = "id") {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ muss eine UUID sein.`);
  }

  return value;
}

export function uuidField(object, name, required = false) {
  const value = stringField(object, name, {
    required,
    maximum: 64,
  });

  if (value === undefined || value === null) {
    return value;
  }

  return uuidValue(value, name);
}

export function dateTimeValue(value, name = "dateTime", { nullable = false } = {}) {
  if (value === null && nullable) {
    return null;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ muss ein Datum mit Uhrzeit sein.`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ enthält kein gültiges Datum.`);
  }

  return date;
}

export function dateTimeField(
  object,
  name,
  { required = false, nullable = false } = {},
) {
  const value = object?.[name];

  if (value === undefined) {
    if (required) {
      throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ ist erforderlich.`);
    }

    return undefined;
  }

  return dateTimeValue(value, name, { nullable });
}

export function dateQuery(value, name) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw badRequest("VALIDATION_ERROR", `Der Parameter „${name}“ muss YYYY-MM-DD entsprechen.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw badRequest("VALIDATION_ERROR", `Der Parameter „${name}“ ist ungültig.`);
  }

  return String(value);
}

export function arrayField(
  object,
  name,
  { required = false, minimum = 0, maximum = 10_000 } = {},
) {
  const value = object?.[name];

  if (value === undefined) {
    if (required) {
      throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ ist erforderlich.`);
    }

    return undefined;
  }

  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw badRequest(
      "VALIDATION_ERROR",
      `Das Feld „${name}“ muss zwischen ${minimum} und ${maximum} Einträge enthalten.`,
    );
  }

  return value;
}

export function queryInteger(
  value,
  name,
  { fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {},
) {
  if (value === undefined || value === "") {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw badRequest(
      "VALIDATION_ERROR",
      `Der Parameter „${name}“ muss zwischen ${minimum} und ${maximum} liegen.`,
    );
  }

  return number;
}

export function nullableText(value, maximum = 10_000) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const text = String(value).trim();

  if (text.length > maximum) {
    throw badRequest("VALIDATION_ERROR", `Der Text darf höchstens ${maximum} Zeichen lang sein.`);
  }

  return text || null;
}

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
