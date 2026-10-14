import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { config } from "../config.js";

// Bekannte Tenant-ID für private Microsoft-Konten (outlook.com, hotmail …)
const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const CLOCK_SKEW_SECONDS = 300;

function microsoftTenant() {
  return config.oauth.microsoft.tenant || "common";
}

const PROVIDERS = {
  google: {
    id: "google",
    name: "Google",
    settings: () => config.oauth.google,
    authorizationUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: () => "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    extraAuthorizationParameters: { prompt: "select_account" },
    validateIssuer(claims) {
      return ["https://accounts.google.com", "accounts.google.com"].includes(
        claims.iss,
      );
    },
    subject: (claims) => claims.sub,
    email: (claims) => claims.email || null,
  },

  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    settings: () => config.oauth.microsoft,
    authorizationUrl: () =>
      `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant())}/oauth2/v2.0/authorize`,
    tokenUrl: () =>
      `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant())}/oauth2/v2.0/token`,
    scope: "openid email profile",
    extraAuthorizationParameters: { prompt: "select_account" },
    validateIssuer(claims) {
      const tid = String(claims.tid || "");

      if (!/^[0-9a-f-]{36}$/i.test(tid)) {
        return false;
      }

      if (claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) {
        return false;
      }

      const tenant = microsoftTenant().toLowerCase();

      if (tenant === "common") return true;
      if (tenant === "consumers") return tid === MICROSOFT_CONSUMER_TENANT;
      if (tenant === "organizations") return tid !== MICROSOFT_CONSUMER_TENANT;

      // Konkreter Tenant: nur Konten aus genau diesem Verzeichnis
      return tid.toLowerCase() === tenant;
    },
    // oid ist innerhalb des Tenants stabil und hängt – anders als sub –
    // nicht von der App-Registrierung ab.
    subject: (claims) =>
      claims.tid && claims.oid ? `${claims.tid}:${claims.oid}` : null,
    email: (claims) => claims.email || claims.preferred_username || null,
  },
};

export class OAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

export function getProvider(providerId) {
  const provider = PROVIDERS[providerId];

  if (!provider) {
    return null;
  }

  const settings = provider.settings();
  return settings?.clientId && settings?.clientSecret ? provider : null;
}

export function listProviders() {
  return Object.values(PROVIDERS).map((provider) => ({
    id: provider.id,
    name: provider.name,
    enabled: Boolean(getProvider(provider.id)),
  }));
}

export function redirectUri(providerId) {
  return `${config.publicBaseUrl}/api/v1/auth/oauth/${providerId}/callback`;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

export function buildAuthorizationUrl(provider, { state, codeVerifier, nonce }) {
  const url = new URL(provider.authorizationUrl());
  const parameters = {
    client_id: provider.settings().clientId,
    response_type: "code",
    redirect_uri: redirectUri(provider.id),
    scope: provider.scope,
    state,
    nonce,
    code_challenge: sha256Base64Url(codeVerifier),
    code_challenge_method: "S256",
    ...provider.extraAuthorizationParameters,
  };

  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");

  if (parts.length !== 3) {
    throw new OAuthError("OAUTH_INVALID_ID_TOKEN", "Ungültiges ID-Token.");
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new OAuthError("OAUTH_INVALID_ID_TOKEN", "Ungültiges ID-Token.");
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Tauscht den Autorisierungscode gegen Tokens und prüft das ID-Token.
 *
 * Das ID-Token kommt direkt per TLS vom Token-Endpunkt des Anbieters, der
 * zusätzlich unser Client-Secret prüft. Nach OIDC Core 3.1.3.7 darf dann die
 * TLS-Prüfung die Signaturprüfung ersetzen; iss, aud, exp und nonce prüfen
 * wir trotzdem.
 */
export async function exchangeCode(provider, { code, codeVerifier, nonce }) {
  const settings = provider.settings();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response;

  try {
    response = await fetch(provider.tokenUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(provider.id),
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code_verifier: codeVerifier,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    console.error(`OAuth-Token-Abruf bei ${provider.name} fehlgeschlagen:`, error);
    throw new OAuthError(
      "OAUTH_PROVIDER_UNREACHABLE",
      `${provider.name} ist nicht erreichbar.`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.id_token) {
    console.error(
      `OAuth-Token-Abruf bei ${provider.name}: HTTP ${response.status}`,
      body?.error,
      body?.error_description,
    );
    throw new OAuthError(
      "OAUTH_TOKEN_EXCHANGE_FAILED",
      `Die Anmeldung bei ${provider.name} konnte nicht abgeschlossen werden.`,
    );
  }

  const claims = decodeJwtPayload(body.id_token);
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (
    !provider.validateIssuer(claims) ||
    !audiences.includes(settings.clientId) ||
    typeof claims.exp !== "number" ||
    claims.exp + CLOCK_SKEW_SECONDS < now ||
    (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS > now) ||
    !claims.nonce ||
    !safeEqual(claims.nonce, nonce)
  ) {
    throw new OAuthError("OAUTH_INVALID_ID_TOKEN", "Das ID-Token ist ungültig.");
  }

  const subject = provider.subject(claims);

  if (!subject) {
    throw new OAuthError(
      "OAUTH_INVALID_ID_TOKEN",
      "Das ID-Token enthält keine Kontokennung.",
    );
  }

  return {
    subject: String(subject).slice(0, 255),
    email: provider.email(claims)?.slice(0, 320) || null,
    displayName: claims.name ? String(claims.name).slice(0, 200) : null,
  };
}
