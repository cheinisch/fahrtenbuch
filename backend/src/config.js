import "dotenv/config";

function rawValue(...names) {
  for (const name of names) {
    const value = process.env[name];

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

function stringValue(names, fallback = undefined) {
  const list = Array.isArray(names) ? names : [names];
  const value = rawValue(...list);

  return value === undefined ? fallback : value;
}

function required(names) {
  const list = Array.isArray(names) ? names : [names];
  const value = stringValue(list);

  if (!value) {
    throw new Error(
      `${list.join(" oder ")} ist nicht konfiguriert.`,
    );
  }

  return value;
}

function integerValue(
  names,
  fallback,
  minimum = undefined,
  maximum = undefined,
) {
  const list = Array.isArray(names) ? names : [names];
  const raw = stringValue(list);
  const value =
    raw === undefined ? fallback : Number(raw);

  if (!Number.isInteger(value)) {
    throw new Error(
      `${list[0]} muss eine ganze Zahl sein.`,
    );
  }

  if (
    minimum !== undefined &&
    value < minimum
  ) {
    throw new Error(
      `${list[0]} muss mindestens ${minimum} sein.`,
    );
  }

  if (
    maximum !== undefined &&
    value > maximum
  ) {
    throw new Error(
      `${list[0]} darf höchstens ${maximum} sein.`,
    );
  }

  return value;
}

// Offizielle Android-App (Google Play). Der Fingerabdruck des App-Signaturschlüssels ist
// nicht geheim – er steht in jeder ausgelieferten APK –, daher hier fest hinterlegt.
export const OFFICIAL_ANDROID_APP = {
  packageName: "app.fahrtenbuch.mobile",
  certFingerprints: [
    // SHA-256 des App-Signaturschlüssels (Play Console › App-Integrität › App-Signatur)
    "49:DA:99:6D:9C:33:5E:AA:35:01:72:33:29:EB:F1:0E:FD:8E:CA:85:13:89:AD:92:CD:01:FC:C1:F6:21:DC:E7",
  ],
};

/** "AA:BB:…" bzw. "AABB…" → "AA:BB:…"; ungültige Werte → null. */
export function normalizeFingerprint(value) {
  const hex = String(value || "").trim().toUpperCase().replace(/:/g, "");
  return /^[0-9A-F]{64}$/.test(hex) ? hex.match(/.{2}/g).join(":") : null;
}

function fingerprintList(value) {
  return String(value || "")
    .split(/[,\s|]+/)
    .map(normalizeFingerprint)
    .filter(Boolean);
}

/**
 * Android-Apps, die Passkeys dieser Instanz nutzen dürfen (assetlinks.json + WebAuthn-Origin):
 * - die offizielle App (abschaltbar mit ANDROID_OFFICIAL_APP_ENABLED=false),
 * - ANDROID_APP_CERT_SHA256: zusätzliche Fingerabdrücke für das Paket ANDROID_APP_PACKAGE
 *   (Standard: offizielles Paket, z. B. für selbst gebaute Debug-APKs),
 * - ANDROID_EXTRA_APPS: weitere Apps als "paket=FP[|FP]; paket2=FP".
 */
export function androidAppsConfig(env = process.env) {
  const apps = new Map();
  const add = (packageName, fingerprints) => {
    const name = String(packageName || "").trim();
    if (!/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(name) || fingerprints.length === 0) return;
    const set = apps.get(name) || new Set();
    fingerprints.forEach((fingerprint) => set.add(fingerprint));
    apps.set(name, set);
  };

  const officialEnabled = !["false", "0", "no", "off"].includes(String(env.ANDROID_OFFICIAL_APP_ENABLED ?? "true").trim().toLowerCase());
  if (officialEnabled) {
    add(OFFICIAL_ANDROID_APP.packageName, OFFICIAL_ANDROID_APP.certFingerprints.map(normalizeFingerprint).filter(Boolean));
  }
  add(env.ANDROID_APP_PACKAGE || OFFICIAL_ANDROID_APP.packageName, fingerprintList(env.ANDROID_APP_CERT_SHA256));
  for (const entry of String(env.ANDROID_EXTRA_APPS || "").split(/[;\n]+/)) {
    const [packageName, fingerprints] = entry.split("=");
    if (fingerprints) add(packageName, fingerprintList(fingerprints));
  }

  return [...apps].map(([packageName, fingerprints]) => ({ packageName, certFingerprints: [...fingerprints] }));
}

function booleanValue(names, fallback = false) {
  const list = Array.isArray(names) ? names : [names];
  const raw = stringValue(list);

  if (raw === undefined) {
    return fallback;
  }

  return [
    "1",
    "true",
    "yes",
    "on",
  ].includes(String(raw).toLowerCase());
}

function normalizedUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

const jwtSecret = required([
  "JWT_SECRET",
  "JWT_ACCESS_SECRET",
]);

const publicBaseUrl = normalizedUrl(
  stringValue(
    "PUBLIC_BASE_URL",
    `${stringValue(
      "APP_PROTOCOL",
      "http",
    )}://${stringValue(
      "APP_HOST",
      "localhost",
    )}`,
  ),
);

const appChannel = String(process.env.APP_CHANNEL || "dev").trim().toLowerCase() === "release" ? "release" : "dev";

export const config = Object.freeze({
  env: stringValue(
    ["APP_ENV", "NODE_ENV"],
    "production",
  ),

  port: integerValue(
    ["PORT", "APP_PORT"],
    3000,
    1,
    65535,
  ),

  version: stringValue(
    "APP_VERSION",
    "dev",
  ),

  build: integerValue(
    "APP_BUILD",
    0,
    0,
  ),

  buildDate: stringValue(
    "BUILD_DATE",
    "unknown",
  ),

  vcsRef: stringValue(
    "VCS_REF",
    "unknown",
  ),

  // Build-Kanal: "dev" im :dev-Image und bei lokaler Entwicklung, "release" im :latest-Image
  channel: appChannel,

  // Neue Funktionen erscheinen zuerst nur im dev-Kanal; per Umgebungsvariable übersteuerbar
  features: {
    expenses: booleanValue("FEATURE_EXPENSES", appChannel === "dev"),
  },

  publicBaseUrl,

  trustProxy: booleanValue(
    "TRUST_PROXY",
    false,
  ),

  // Profilbilder von Gravatar für die ganze Instanz erlauben (Datenschutz: false schaltet es ab)
  gravatarEnabled: booleanValue(
    "GRAVATAR_ENABLED",
    true,
  ),

  // Adresse, unter der Admins Redis Insight im Browser öffnen (z. B. hinter
  // einem Reverse-Proxy mit Anmeldung). Leer: Hinweis auf localhost/SSH-Tunnel.
  redisInsightUrl: normalizedUrl(
    stringValue("REDIS_INSIGHT_URL", ""),
  ) || null,

  redisInsightPort: integerValue(
    "REDIS_INSIGHT_PORT",
    5540,
    1,
    65535,
  ),

  debug: booleanValue(
    ["DEBUG", "APP_DEBUG"],
    false,
  ),

  staticDirectory: stringValue(
    "STATIC_DIR",
    "/app/frontend/dist",
  ),

  backupDirectory: stringValue(
    "BACKUP_DIR",
    "/data/backups",
  ),

  // Festes Upload-/Import-Limit: 200 MiB.
  // Dafür ist keine ENV-Variable mehr erforderlich.
  uploadLimitBytes: 200 * 1024 * 1024,

  database: {
    host: stringValue(
      ["POSTGRES_HOST", "DB_HOST"],
      "db",
    ),

    port: integerValue(
      ["POSTGRES_PORT", "DB_PORT"],
      5432,
      1,
      65535,
    ),

    database: stringValue(
      ["POSTGRES_DB", "DB_NAME"],
      "fahrtenbuch",
    ),

    user: stringValue(
      ["POSTGRES_USER", "DB_USER"],
      "fahrtenbuch",
    ),

    password: required([
      "POSTGRES_PASSWORD",
      "DB_PASSWORD",
    ]),

    ssl: booleanValue(
      ["POSTGRES_SSL", "DB_SSL"],
      false,
    ),
  },

  jwt: {
    secret: jwtSecret,

    accessExpiresIn: stringValue(
      ["JWT_EXPIRES_IN", "JWT_ACCESS_TTL"],
      "15m",
    ),

    refreshExpiresIn: stringValue(
      [
        "REFRESH_TOKEN_EXPIRES_IN",
        "JWT_REFRESH_TTL",
      ],
      "30d",
    ),

    issuer: stringValue(
      "JWT_ISSUER",
      "fahrtenbuch",
    ),

    audience: stringValue(
      "JWT_AUDIENCE",
      "fahrtenbuch-app",
    ),
  },

  // Anmeldeverfahren serverweit an- oder abschalten. Abgeschaltet heißt:
  // keine Einrichtung, keine Anmeldung bzw. keine Code-Abfrage. Gespeicherte
  // Secrets/Passkeys bleiben erhalten und gelten nach dem Einschalten wieder.
  authMethods: {
    totp: booleanValue("TOTP_ENABLED", true),
    passkeys: booleanValue("PASSKEYS_ENABLED", true),
  },

  totp: {
    encryptionKey: stringValue(
      "TOTP_ENCRYPTION_KEY",
      jwtSecret,
    ),

    issuer: stringValue(
      "TOTP_ISSUER",
      "Fahrtenbuch",
    ),
  },

  webauthn: {
    rpName: stringValue(
      ["WEBAUTHN_RP_NAME", "RP_NAME"],
      "Fahrtenbuch",
    ),

    rpId: stringValue(
      ["WEBAUTHN_RP_ID", "RP_ID"],
      "localhost",
    ),

    origin: normalizedUrl(
      stringValue(
        [
          "WEBAUTHN_ORIGIN",
          "RP_ORIGIN",
        ],
        publicBaseUrl,
      ),
    ),
  },

  // Android-App: Passkeys über den Credential Manager. Die App ist über
  // /.well-known/assetlinks.json mit der Domain (WEBAUTHN_RP_ID) verknüpft und
  // meldet sich mit dem Origin android:apk-key-hash:<SHA-256 des Signaturzertifikats>.
  // Jede Instanz erlaubt die offizielle App aus Google Play (fest hinterlegter Fingerabdruck),
  // weitere Zertifikate (Debug-Builds) und eigene Apps/Forks kommen optional per Umgebung dazu.
  androidApps: androidAppsConfig(),

  // Anmeldung mit verknüpftem Google-/Microsoft-Konto. Ein Anbieter ist
  // aktiv, sobald Client-ID und Secret gesetzt sind. Redirect-URI beim
  // Anbieter: <PUBLIC_BASE_URL>/api/v1/auth/oauth/<provider>/callback
  oauth: {
    google: {
      clientId: stringValue("GOOGLE_OAUTH_CLIENT_ID", null),
      clientSecret: stringValue("GOOGLE_OAUTH_CLIENT_SECRET", null),
    },

    microsoft: {
      clientId: stringValue("MICROSOFT_OAUTH_CLIENT_ID", null),
      clientSecret: stringValue("MICROSOFT_OAUTH_CLIENT_SECRET", null),
      // common | organizations | consumers | <Tenant-ID>
      tenant: stringValue("MICROSOFT_OAUTH_TENANT", "common"),
    },

    // Erlaubte Rücksprungadressen der mobilen App (kommagetrennt). Nur an
    // diese Adressen leitet der Server nach der App-Anmeldung weiter.
    appRedirectUris: stringValue(
      "OAUTH_APP_REDIRECT_URIS",
      "fahrtenbuch://oauth/callback",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  },

  passwordReset: {
    expiresMinutes: integerValue(
      "PASSWORD_RESET_EXPIRES_MINUTES",
      30,
      5,
      1440,
    ),

    publicUrl: normalizedUrl(
      stringValue(
        [
          "PASSWORD_RESET_URL",
          "PASSWORD_RESET_RETURN_LINK",
        ],
        `${publicBaseUrl}/password-reset`,
      ),
    ),

    webhookUrl: stringValue(
      "PASSWORD_RESET_WEBHOOK_URL",
      null,
    ),
  },

  services: {
    map: {
      provider: stringValue(
        "MAP_PROVIDER",
        "osm",
      ),

      type: stringValue(
        "MAP_TYPE",
        "raster",
      ),

      tileUrl: stringValue(
        "MAP_TILE_URL",
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      ),

      styleUrl: stringValue(
        "MAP_STYLE_URL",
        null,
      ),

      // Die Quellenangabe kommt fest aus dem Code.
      // Dafür ist keine MAP_ATTRIBUTION-Variable nötig.
      attribution:
        "© OpenStreetMap contributors",

      minZoom: integerValue(
        "MAP_MIN_ZOOM",
        0,
        0,
        24,
      ),

      maxZoom: integerValue(
        "MAP_MAX_ZOOM",
        19,
        0,
        24,
      ),

      tileSize: integerValue(
        "MAP_TILE_SIZE",
        256,
        256,
        512,
      ),
    },

    photon: {
      provider: stringValue(
        "PHOTON_PROVIDER",
        "public",
      ),

      baseUrl: normalizedUrl(
        stringValue(
          "PHOTON_URL",
          "https://photon.komoot.io",
        ),
      ),

      timeoutMs: integerValue(
        "PHOTON_TIMEOUT_MS",
        10_000,
        1000,
        120_000,
      ),
    },

    // Dawarich Atlas (Photon + Valhalla gebündelt), standardmäßig aus
    atlas: {
      enabled: booleanValue(
        "ATLAS_ENABLED",
        Boolean(stringValue("ATLAS_URL")),
      ),

      baseUrl: normalizedUrl(
        stringValue(
          "ATLAS_URL",
          "",
        ),
      ),

      timeoutMs: integerValue(
        "ATLAS_TIMEOUT_MS",
        10_000,
        1000,
        120_000,
      ),
    },

    overpass: {
      provider: stringValue(
        "OVERPASS_PROVIDER",
        "public",
      ),

      interpreterUrl: stringValue(
        "OVERPASS_URL",
        "https://overpass-api.de/api/interpreter",
      ),

      timeoutMs: integerValue(
        "OVERPASS_TIMEOUT_MS",
        30_000,
        1000,
        180_000,
      ),

      searchRadiusMeters: integerValue(
        "OVERPASS_RADIUS_METERS",
        2500,
        1,
        50_000,
      ),

      maxResults: integerValue(
        "OVERPASS_MAX_RESULTS",
        50,
        1,
        500,
      ),
    },
  },
});