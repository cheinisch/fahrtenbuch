import {
  createHash,
  randomBytes,
} from "node:crypto";
import jwt from "jsonwebtoken";

function requiredEnvironment(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} ist nicht konfiguriert.`);
  }

  return value;
}

function durationToMilliseconds(value) {
  const match = /^(\d+)(s|m|h|d)$/.exec(String(value));

  if (!match) {
    throw new Error(`Ungültige Zeitangabe: ${value}`);
  }

  const amount = Number(match[1]);

  const factors = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * factors[match[2]];
}

export function createRefreshToken() {
  return randomBytes(48).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function getRefreshExpiration() {
  const duration =
    process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";

  return new Date(Date.now() + durationToMilliseconds(duration));
}

export function createAccessToken(user, sessionId) {
  const secret = requiredEnvironment("JWT_SECRET");

  return jwt.sign(
    {
      sub: user.id,
      sid: sessionId,
      role: user.role,
      typ: "access",
    },
    secret,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "15m",
      issuer: process.env.JWT_ISSUER || "fahrtenbuch",
      audience:
        process.env.JWT_AUDIENCE || "fahrtenbuch-web",
    },
  );
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(
    token,
    requiredEnvironment("JWT_SECRET"),
    {
      issuer: process.env.JWT_ISSUER || "fahrtenbuch",
      audience:
        process.env.JWT_AUDIENCE || "fahrtenbuch-web",
    },
  );

  if (
    typeof payload !== "object" ||
    payload.typ !== "access" ||
    !payload.sub ||
    !payload.sid
  ) {
    throw new Error("Ungültiges Access-Token.");
  }

  return payload;
}

export function getAccessTokenExpiration(token) {
  const payload = jwt.decode(token);

  if (
    typeof payload !== "object" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Access-Token enthält keine Ablaufzeit.");
  }

  return new Date(payload.exp * 1000);
}