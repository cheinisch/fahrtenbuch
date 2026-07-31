import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

import { config } from "../config.js";

export function durationToMilliseconds(value) {
  const match = /^(\d+)(s|m|h|d)$/i.exec(String(value).trim());

  if (!match) {
    throw new Error(`Ungültige Zeitangabe „${value}“.`);
  }

  const amount = Number(match[1]);
  const factors = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * factors[match[2].toLowerCase()];
}

export function createOpaqueToken(bytes = 48) {
  return randomBytes(bytes).toString("base64url");
}

export function createRefreshToken() {
  return createOpaqueToken(48);
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function getRefreshExpiration() {
  return new Date(
    Date.now() + durationToMilliseconds(config.jwt.refreshExpiresIn),
  );
}

export function getAccessTokenLifetimeSeconds() {
  return Math.floor(durationToMilliseconds(config.jwt.accessExpiresIn) / 1000);
}

export function createAccessToken(user, sessionId) {
  if (!user?.id || !sessionId) {
    throw new Error("Benutzer-ID und Session-ID fehlen.");
  }

  return jwt.sign(
    {
      sub: user.id,
      sid: sessionId,
      role: user.role,
      typ: "access",
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.accessExpiresIn,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    },
  );
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwt.secret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });

  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.typ !== "access" ||
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string"
  ) {
    throw new Error("Ungültiges Access-Token.");
  }

  return payload;
}

export function getAccessTokenExpiration(token) {
  const payload = jwt.decode(token);

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Access-Token enthält keine Ablaufzeit.");
  }

  return new Date(payload.exp * 1000);
}
