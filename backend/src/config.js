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
  androidApp: {
    packageName: stringValue("ANDROID_APP_PACKAGE", "app.fahrtenbuch.mobile"),
    // Kommagetrennte SHA-256-Fingerabdrücke (Play App Signing, Upload- bzw. Debug-Zertifikat)
    certFingerprints: (stringValue("ANDROID_APP_CERT_SHA256", "") || "")
      .split(/[,\s]+/)
      .map((value) => value.trim().toUpperCase())
      .filter((value) => /^([0-9A-F]{2}:?){31}[0-9A-F]{2}$/.test(value))
      .map((value) => value.replace(/:/g, "").match(/.{2}/g).join(":")),
  },

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