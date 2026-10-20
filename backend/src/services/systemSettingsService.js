import { config } from "../config.js";
import { pool } from "../database/pool.js";

// Systemeinstellungen rund um die Ersteinrichtung. Gravatar liegt in app_settings
// (GRAVATAR_ENABLED bleibt Fallback, solange nichts gespeichert wurde); SMTP kommt
// ausschließlich aus der Umgebung.

const GRAVATAR_KEY = "privacy.gravatar";
const SETUP_KEY = "setup.completed";

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
// SMTP – nur über die Umgebung (SMTP_*). Die Oberfläche zeigt den Status und
// kann eine Test-Mail senden, speichert aber nichts.
// ---------------------------------------------------------------------------

/** SMTP aus der Umgebung, oder null. */
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

/** Wirksame SMTP-Konfiguration inkl. Klartext-Passwort – nur serverintern verwenden. */
export function resolveMailSettings(env = process.env) {
  return environmentMailSettings(env);
}

export function isMailSettingsComplete(settings) {
  return Boolean(settings?.host && settings?.fromAddress);
}

/** Für die Oberfläche: ohne Passwort, nur ob eines gesetzt ist. */
export function getMailStatus(env = process.env) {
  const settings = resolveMailSettings(env);
  if (!settings) {
    return { configured: false, host: "", port: null, security: null, username: "", passwordSet: false, fromAddress: "", fromName: "" };
  }
  const { password, ...rest } = settings;
  return { ...rest, configured: isMailSettingsComplete(settings), passwordSet: Boolean(password) };
}

export function isMailConfigured(env = process.env) {
  return isMailSettingsComplete(resolveMailSettings(env));
}

/** Optionen für nodemailer.createTransport aus einer (aufgelösten) SMTP-Konfiguration. */
export function transportOptions(settings) {
  return {
    host: settings.host,
    port: Number(settings.port || 587),
    // Wie bisher: SMTP_SECURE=true = implizites TLS, sonst STARTTLS, wenn der Server es anbietet
    secure: settings.security === "tls",
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
