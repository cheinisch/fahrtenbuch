import { config } from "../config.js";
import { pool } from "../database/pool.js";
import { badRequest } from "../lib/errors.js";
import {
  booleanField,
  enumField,
  integerField,
  objectBody,
  stringField,
} from "../lib/validation.js";
import { decryptSecret, encryptSecret } from "../security/encryption.js";

// Systemeinstellungen, die früher nur aus der .env kamen (SMTP, Gravatar) und jetzt in
// app_settings liegen. Die Umgebungsvariablen bleiben Fallback, solange in der Oberfläche
// nichts gespeichert wurde – bestehende Installationen laufen unverändert weiter.

const MAIL_KEY = "mail.smtp";
const GRAVATAR_KEY = "privacy.gravatar";
const SETUP_KEY = "setup.completed";

const SECURITY_MODES = ["starttls", "tls", "none"];

async function readRaw(key, client = pool) {
  const result = await client.query(
    `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
    [key],
  );
  return result.rows[0]?.value ?? null;
}

async function writeRaw(key, value, userId, client = pool) {
  await client.query(
    `
      INSERT INTO app_settings (key, value, is_public, updated_by_user_id)
      VALUES ($1, $2::jsonb, false, $3)
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_by_user_id = EXCLUDED.updated_by_user_id
    `,
    [key, JSON.stringify(value), userId || null],
  );
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

/** SMTP aus der Umgebung (Altbestand), oder null. */
export function environmentMailSettings(env = process.env) {
  const host = String(env.SMTP_HOST || "").trim();
  if (!host) return null;
  const secure = String(env.SMTP_SECURE || "").toLowerCase() === "true";
  return {
    host,
    port: Number(env.SMTP_PORT || (secure ? 465 : 587)),
    security: secure ? "tls" : "starttls",
    username: String(env.SMTP_USER || "").trim(),
    password: env.SMTP_PASSWORD || "",
    fromAddress: String(env.SMTP_FROM || "").trim(),
    fromName: String(env.SMTP_FROM_NAME || "").trim(),
  };
}

function decryptStoredPassword(stored) {
  if (!stored?.passwordEncrypted) return "";
  try {
    return decryptSecret(stored.passwordEncrypted);
  } catch {
    // Schlüssel geändert (TOTP_ENCRYPTION_KEY/JWT_SECRET): Passwort muss neu eingegeben werden
    return "";
  }
}

/** Wirksame SMTP-Konfiguration inkl. Klartext-Passwort – nur serverintern verwenden. */
export async function resolveMailSettings(client = pool) {
  const stored = await readRaw(MAIL_KEY, client);
  if (stored?.host) {
    return {
      source: "database",
      host: stored.host,
      port: Number(stored.port || 587),
      security: SECURITY_MODES.includes(stored.security) ? stored.security : "starttls",
      username: stored.username || "",
      password: decryptStoredPassword(stored),
      fromAddress: stored.fromAddress || "",
      fromName: stored.fromName || "",
    };
  }
  const env = environmentMailSettings();
  return env ? { source: "environment", ...env } : null;
}

export function isMailSettingsComplete(settings) {
  return Boolean(settings?.host && settings?.fromAddress);
}

/** Für die Oberfläche: ohne Passwort, nur ob eines hinterlegt ist. */
export async function getMailSettingsForAdmin(client = pool) {
  const settings = await resolveMailSettings(client);
  if (!settings) {
    return {
      source: "none",
      configured: false,
      host: "",
      port: 587,
      security: "starttls",
      username: "",
      passwordSet: false,
      fromAddress: "",
      fromName: "",
    };
  }
  const { password, ...rest } = settings;
  return { ...rest, configured: isMailSettingsComplete(settings), passwordSet: Boolean(password) };
}

export async function isMailConfigured(client = pool) {
  return isMailSettingsComplete(await resolveMailSettings(client));
}

/**
 * Prüft Eingaben aus der Oberfläche. Ein leeres Passwort bedeutet „unverändert“, damit
 * das gespeicherte Secret nie zurück an den Browser muss. `clearPassword` entfernt es.
 */
export async function parseMailSettings(input, client = pool) {
  const body = objectBody(input);
  const host = stringField(body, "host", { required: true, minimum: 1, maximum: 253 });
  const port = integerField(body, "port", { minimum: 1, maximum: 65535 }) ?? 587;
  const security = enumField(body, "security", SECURITY_MODES) ?? "starttls";
  const username = stringField(body, "username", { nullable: true, maximum: 320 }) || "";
  const fromAddress = stringField(body, "fromAddress", { required: true, minimum: 3, maximum: 320 });
  const fromName = stringField(body, "fromName", { nullable: true, maximum: 120 }) || "";
  const newPassword = stringField(body, "password", { nullable: true, maximum: 1024, trim: false });
  const clearPassword = booleanField(body, "clearPassword") === true;

  if (!/^[^\s@]+@[^\s@]+$/.test(fromAddress)) {
    throw badRequest("VALIDATION_ERROR", "Die Absenderadresse ist ungültig.");
  }

  let password = "";
  if (!clearPassword) {
    if (newPassword) {
      password = newPassword;
    } else {
      // Bisheriges Passwort übernehmen – auch das aus der .env beim ersten Speichern
      const current = await resolveMailSettings(client);
      password = current?.password || "";
    }
  }

  return { host, port, security, username, password, fromAddress, fromName };
}

export async function saveMailSettings(input, userId, client = pool) {
  const settings = await parseMailSettings(input, client);
  const { password, ...rest } = settings;
  await writeRaw(
    MAIL_KEY,
    { ...rest, passwordEncrypted: password ? encryptSecret(password) : null },
    userId,
    client,
  );
  return getMailSettingsForAdmin(client);
}

/** Entfernt die gespeicherten SMTP-Daten; danach gilt wieder die .env (falls gesetzt). */
export async function deleteMailSettings(client = pool) {
  await client.query(`DELETE FROM app_settings WHERE key = $1`, [MAIL_KEY]);
  return getMailSettingsForAdmin(client);
}

/** Optionen für nodemailer.createTransport aus einer (aufgelösten) SMTP-Konfiguration. */
export function transportOptions(settings) {
  return {
    host: settings.host,
    port: Number(settings.port || 587),
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    ignoreTLS: settings.security === "none",
    auth: settings.username ? { user: settings.username, pass: settings.password || "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  };
}

export function fromHeader(settings) {
  const name = String(settings.fromName || "").replace(/["\r\n]/g, "").trim();
  return name ? `"${name}" <${settings.fromAddress}>` : settings.fromAddress;
}

// ---------------------------------------------------------------------------
// Gravatar
// ---------------------------------------------------------------------------

// Der Wert wird synchron gebraucht (CSP-Header, Mapping der Benutzereinstellungen),
// daher ein kleiner Cache, der beim Speichern sofort und sonst nach 60 s erneuert wird.
let gravatarCache = { enabled: config.gravatarEnabled, source: "environment", loadedAt: 0 };
let gravatarRefresh = null;
const GRAVATAR_TTL_MS = 60_000;

export async function refreshGravatarSetting(client = pool) {
  const stored = await readRaw(GRAVATAR_KEY, client);
  gravatarCache = typeof stored?.enabled === "boolean"
    ? { enabled: stored.enabled, source: "database", loadedAt: Date.now() }
    : { enabled: config.gravatarEnabled, source: "environment", loadedAt: Date.now() };
  return { enabled: gravatarCache.enabled, source: gravatarCache.source };
}

/** Synchroner Zugriff; stößt bei veraltetem Cache im Hintergrund ein Neuladen an. */
export function isGravatarEnabled() {
  if (Date.now() - gravatarCache.loadedAt > GRAVATAR_TTL_MS && !gravatarRefresh) {
    gravatarRefresh = refreshGravatarSetting()
      .catch(() => {})
      .finally(() => { gravatarRefresh = null; });
  }
  return gravatarCache.enabled;
}

export async function getGravatarSetting(client = pool) {
  return refreshGravatarSetting(client);
}

export async function saveGravatarSetting(enabled, userId, client = pool) {
  await writeRaw(GRAVATAR_KEY, { enabled: Boolean(enabled) }, userId, client);
  return refreshGravatarSetting(client);
}

// ---------------------------------------------------------------------------
// Ersteinrichtung
// ---------------------------------------------------------------------------

export async function getSetupState(client = pool) {
  const stored = await readRaw(SETUP_KEY, client);
  return {
    completed: Boolean(stored),
    completedAt: stored?.completedAt ?? null,
  };
}

export async function markSetupCompleted(userId, client = pool) {
  const existing = await readRaw(SETUP_KEY, client);
  if (!existing) {
    await writeRaw(SETUP_KEY, { completedAt: new Date().toISOString(), completedBy: userId }, userId, client);
  }
  return getSetupState(client);
}

/** Was nur über die Docker-Umgebung einstellbar ist – der Assistent zeigt es als Status. */
export function environmentStatus() {
  return {
    publicBaseUrl: config.publicBaseUrl,
    publicBaseUrlConfigured: Boolean(process.env.PUBLIC_BASE_URL),
    timezone: process.env.TZ || "Europe/Berlin",
    oauth: {
      google: Boolean(config.oauth.google.clientId && config.oauth.google.clientSecret),
      microsoft: Boolean(config.oauth.microsoft.clientId && config.oauth.microsoft.clientSecret),
      redirectUriTemplate: `${config.publicBaseUrl}/api/v1/auth/oauth/{provider}/callback`,
    },
    passkeys: {
      enabled: config.authMethods.passkeys,
      rpId: config.webauthn.rpId,
    },
    channel: config.channel,
  };
}
