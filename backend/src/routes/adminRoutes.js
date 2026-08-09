import { gzip } from "node:zlib";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";

import { config } from "../config.js";
import { pool } from "../database/pool.js";
import {
  badRequest,
  conflict,
  notFound,
} from "../lib/errors.js";
import { mapUser } from "../lib/mappers.js";
import {
  booleanField,
  emailField,
  enumField,
  integerField,
  numberField,
  objectBody,
  stringField,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { hashPassword } from "../security/password.js";
import { testService } from "../services/geocodingService.js";
import {
  getAdminServiceSettings,
  writeSetting,
} from "../services/serviceSettingsService.js";

export const adminRoutes = Router();

adminRoutes.use(requireAuth);
adminRoutes.use(requireAdmin);

const gzipAsync = promisify(gzip);

async function createUniqueUsername(client, email, preferred = null) {
  const base = String(preferred || email.split("@")[0] || "user")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "user";

  for (let index = 0; index < 10_000; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index}`;
    const existing = await client.query(
      `
        SELECT 1
        FROM users
        WHERE lower(username) = lower($1)
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [candidate],
    );

    if (existing.rowCount === 0) {
      return candidate;
    }
  }

  throw conflict(
    "USERNAME_GENERATION_FAILED",
    "Es konnte kein freier Anmeldename erzeugt werden.",
  );
}

function parseMapSettings(body) {
  const input = objectBody(body);
  const provider = enumField(input, "provider", ["osm", "maplibre", "custom"], {
    required: true,
  });
  const type = enumField(input, "type", ["raster", "vector", "style"], {
    required: true,
  });
  const tileUrl = stringField(input, "tileUrl", {
    nullable: true,
    maximum: 2000,
  });
  const styleUrl = stringField(input, "styleUrl", {
    nullable: true,
    maximum: 2000,
  });

  if (type === "style" && !styleUrl) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Für eine Style-Karte ist styleUrl erforderlich.",
    );
  }

  if (type !== "style" && !tileUrl) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Für diese Kartenart ist tileUrl erforderlich.",
    );
  }

  return {
    provider,
    type,
    tileUrl,
    styleUrl,
    attribution: stringField(input, "attribution", {
      required: true,
      maximum: 1000,
    }),
    minZoom: integerField(input, "minZoom", {
      required: true,
      minimum: 0,
      maximum: 24,
    }),
    maxZoom: integerField(input, "maxZoom", {
      required: true,
      minimum: 0,
      maximum: 24,
    }),
    tileSize: enumField(
      { tileSize: String(input.tileSize) },
      "tileSize",
      ["256", "512"],
      { required: true },
    ) === "512"
      ? 512
      : 256,
  };
}


function parseMapDefaultsSettings(body) {
  const input = objectBody(body);
  const provider = enumField(
    input,
    "provider",
    ["osm", "protomaps", "maplibre", "atlas"],
    { required: true },
  );

  const protomapsTileServerUrl = stringField(input, "protomapsTileServerUrl", {
    nullable: true,
    maximum: 2000,
  }) || "";
  const protomapsAssetsUrl = stringField(input, "protomapsAssetsUrl", {
    nullable: true,
    maximum: 2000,
  }) || "";
  const protomapsFlavor = enumField(
    { protomapsFlavor: input.protomapsFlavor || "auto" },
    "protomapsFlavor",
    ["auto", "light", "dark", "grayscale", "white", "black"],
    { required: true },
  );

  if (provider === "protomaps" && !protomapsTileServerUrl) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Für Protomaps ist die Adresse eines eigenen Tileservers (TileJSON-Endpunkt) erforderlich.",
    );
  }

  for (const [label, value] of [
    ["Protomaps-Tileserver", protomapsTileServerUrl],
    ["Protomaps-Assets", protomapsAssetsUrl],
  ]) {
    if (!value) continue;
    const normalized = value;
    let parsed;
    try {
      parsed = new URL(normalized);
    } catch {
      throw badRequest(
        "VALIDATION_ERROR",
        `${label}-Adresse muss eine gültige URL inklusive http:// oder https:// sein.`,
      );
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw badRequest(
        "VALIDATION_ERROR",
        `${label}-Adresse muss http:// oder https:// verwenden.`,
      );
    }
  }

  return {
    provider: provider === "maplibre" ? "osm" : provider === "atlas" ? "osm" : provider,
    defaultLatitude: numberField(input, "defaultLatitude", {
      required: true,
      minimum: -90,
      maximum: 90,
    }),
    defaultLongitude: numberField(input, "defaultLongitude", {
      required: true,
      minimum: -180,
      maximum: 180,
    }),
    defaultZoom: integerField(input, "defaultZoom", {
      required: true,
      minimum: 0,
      maximum: 24,
    }),
    protomapsTileServerUrl: protomapsTileServerUrl.replace(/\/+$/, ""),
    protomapsAssetsUrl: protomapsAssetsUrl.replace(/\/+$/, ""),
    protomapsFlavor,
  };
}

function parsePhotonSettings(body) {
  const input = objectBody(body);
  const provider = enumField(input, "provider", ["public", "custom"], {
    required: true,
  });
  const baseUrl = stringField(input, "baseUrl", {
    nullable: true,
    maximum: 2000,
  });

  if (provider === "custom" && !baseUrl) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Für einen eigenen Photon-Dienst ist baseUrl erforderlich.",
    );
  }

  return {
    provider,
    baseUrl:
      baseUrl ||
      (provider === "public" ? "https://photon.komoot.io" : null),
    timeoutMs: integerField(input, "timeoutMs", {
      required: true,
      minimum: 1000,
      maximum: 120_000,
    }),
  };
}

function parseMapMatchingSettings(body) {
  const input = objectBody(body);
  const provider = enumField(
    input,
    "provider",
    ["disabled", "osrm", "valhalla"],
    { required: true },
  );
  const osrmUrl = stringField(input, "osrmUrl", {
    nullable: true,
    maximum: 2000,
  }) || "";
  const valhallaUrl = stringField(input, "valhallaUrl", {
    nullable: true,
    maximum: 2000,
  }) || "";

  if (provider === "osrm" && !osrmUrl) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Für OSRM ist eine Serveradresse erforderlich.",
    );
  }

  if (provider === "valhalla" && !valhallaUrl) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Für Valhalla ist eine Serveradresse erforderlich.",
    );
  }

  for (const [label, value] of [["OSRM", osrmUrl], ["Valhalla", valhallaUrl]]) {
    if (!value) continue;

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw badRequest(
        "VALIDATION_ERROR",
        `${label}-Serveradresse muss eine gültige URL inklusive http:// oder https:// sein.`,
      );
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw badRequest(
        "VALIDATION_ERROR",
        `${label}-Serveradresse muss http:// oder https:// verwenden.`,
      );
    }
  }

  return {
    provider,
    osrmUrl: osrmUrl.replace(/\/+$/, ""),
    valhallaUrl: valhallaUrl.replace(/\/+$/, ""),
  };
}

function parseOverpassSettings(body) {
  const input = objectBody(body);
  const provider = enumField(input, "provider", ["public", "custom"], {
    required: true,
  });
  const interpreterUrl = stringField(input, "interpreterUrl", {
    nullable: true,
    maximum: 2000,
  });

  if (provider === "custom" && !interpreterUrl) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Für einen eigenen Overpass-Dienst ist interpreterUrl erforderlich.",
    );
  }

  return {
    provider,
    interpreterUrl:
      interpreterUrl ||
      (provider === "public"
        ? "https://overpass-api.de/api/interpreter"
        : null),
    timeoutMs: integerField(input, "timeoutMs", {
      required: true,
      minimum: 1000,
      maximum: 180_000,
    }),
    searchRadiusMeters: integerField(input, "searchRadiusMeters", {
      required: true,
      minimum: 1,
      maximum: 50_000,
    }),
    maxResults: integerField(input, "maxResults", {
      required: true,
      minimum: 1,
      maximum: 500,
    }),
  };
}

function mapAdminUser(row) {
  return {
    ...mapUser(row),
    passkeyCount: Number(row.passkey_count || 0),
    activeDeviceCount: Number(row.active_device_count || 0),
    vehicleCount: Number(row.vehicle_count || 0),
    tripCount: Number(row.trip_count || 0),
    passkeys: Array.isArray(row.passkeys)
      ? row.passkeys.map((passkey) => ({
          id: passkey.id,
          name: passkey.name || "Passkey",
          transports: passkey.transports || [],
          backedUp: Boolean(passkey.backed_up),
          deviceType: passkey.device_type || null,
          lastUsedAt: passkey.last_used_at || null,
          createdAt: passkey.created_at,
        }))
      : [],
  };
}

async function loadAdminUser(userId, database = pool) {
  const result = await database.query(
    `
      SELECT
        u.id,
        u.email,
        u.username,
        u.display_name,
        u.first_name,
        u.last_name,
        u.password_hash,
        (u.password_hash IS NOT NULL) AS has_password,
        u.role,
        u.status,
        u.locale,
        u.timezone,
        u.theme_mode,
        u.totp_enabled,
        u.totp_required,
        u.passkey_enabled,
        u.force_password_change,
        u.last_login_at,
        u.created_at,
        u.updated_at,
        (
          SELECT count(*)::integer
          FROM passkeys p
          WHERE p.user_id = u.id
        ) AS passkey_count,
        (
          SELECT count(*)::integer
          FROM devices d
          WHERE d.user_id = u.id
            AND d.revoked_at IS NULL
        ) AS active_device_count,
        (
          SELECT count(*)::integer
          FROM vehicles v
          WHERE v.user_id = u.id
            AND v.archived_at IS NULL
        ) AS vehicle_count,
        (
          SELECT count(*)::integer
          FROM trips t
          WHERE t.user_id = u.id
            AND t.archived_at IS NULL
        ) AS trip_count
      FROM users u
      WHERE u.id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  const user = result.rows[0];

  if (!user) {
    return null;
  }

  const passkeys = await database.query(
    `
      SELECT
        id,
        name,
        transports,
        backed_up,
        device_type,
        last_used_at,
        created_at
      FROM passkeys
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId],
  );

  return {
    ...user,
    passkeys: passkeys.rows,
  };
}

async function writeAdminAudit(
  database,
  request,
  action,
  userId,
  metadata = {},
) {
  await database.query(
    `
      INSERT INTO audit_log (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        request_id,
        ip_address,
        user_agent,
        metadata
      )
      VALUES ($1, $2, 'user', $3, $4, $5, $6, $7::jsonb)
    `,
    [
      request.auth.userId,
      action,
      userId,
      request.requestId || null,
      request.ip || null,
      request.get("user-agent") || null,
      JSON.stringify(metadata),
    ],
  );
}

adminRoutes.get(
  "/users",
  asyncHandler(async (_request, response) => {
    const result = await pool.query(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.display_name,
          u.first_name,
          u.last_name,
          (u.password_hash IS NOT NULL) AS has_password,
          u.role,
          u.status,
          u.locale,
          u.timezone,
          u.theme_mode,
          u.totp_enabled,
          u.totp_required,
          u.passkey_enabled,
          u.force_password_change,
          u.last_login_at,
          u.created_at,
          u.updated_at,
          count(DISTINCT p.id)::integer AS passkey_count,
          count(DISTINCT d.id) FILTER (
            WHERE d.revoked_at IS NULL
          )::integer AS active_device_count,
          count(DISTINCT v.id) FILTER (
            WHERE v.archived_at IS NULL
          )::integer AS vehicle_count,
          count(DISTINCT t.id) FILTER (
            WHERE t.archived_at IS NULL
          )::integer AS trip_count
        FROM users u
        LEFT JOIN passkeys p ON p.user_id = u.id
        LEFT JOIN devices d ON d.user_id = u.id
        LEFT JOIN vehicles v ON v.user_id = u.id
        LEFT JOIN trips t ON t.user_id = u.id
        WHERE u.deleted_at IS NULL
        GROUP BY u.id
        ORDER BY
          CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END,
          lower(u.display_name),
          lower(u.email)
      `,
    );

    response.json(result.rows.map(mapAdminUser));
  }),
);

adminRoutes.post(
  "/users",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const email = emailField(body, "email", true);
    const password = stringField(body, "password", {
      required: true,
      minimum: 8,
      maximum: 1024,
      trim: false,
    });
    const preferredUsername =
      stringField(body, "loginName", {
        nullable: true,
        minimum: 3,
        maximum: 64,
      }) ??
      stringField(body, "username", {
        nullable: true,
        minimum: 3,
        maximum: 64,
      });
    const firstName = stringField(body, "firstName", {
      nullable: true,
      minimum: 1,
      maximum: 80,
    });
    const lastName = stringField(body, "lastName", {
      nullable: true,
      minimum: 1,
      maximum: 80,
    });
    const fallbackName =
      [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0];
    const displayName =
      stringField(body, "displayName", {
        nullable: true,
        minimum: 1,
        maximum: 120,
      }) || fallbackName;
    const role = enumField(body, "role", ["user", "admin"]) || "user";
    const status = enumField(body, "status", ["active", "disabled"]) || "active";
    const locale =
      stringField(body, "locale", {
        minimum: 2,
        maximum: 16,
      }) || "de";
    const timezone =
      stringField(body, "timezone", {
        minimum: 1,
        maximum: 64,
      }) || "Europe/Berlin";
    const themeMode =
      enumField(body, "themeMode", ["light", "dark", "system"]) || "system";
    const forcePasswordChange =
      booleanField(body, "forcePasswordChange") ?? true;
    const totpRequired = booleanField(body, "totpRequired") ?? false;
    const passkeyEnabled = booleanField(body, "passkeyEnabled") ?? true;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const username = await createUniqueUsername(
        client,
        email,
        preferredUsername,
      );
      const passwordHash = await hashPassword(password);

      const result = await client.query(
        `
          INSERT INTO users (
            email,
            username,
            display_name,
            first_name,
            last_name,
            password_hash,
            password_changed_at,
            role,
            status,
            locale,
            timezone,
            theme_mode,
            totp_required,
            passkey_enabled,
            force_password_change
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, now(), $7, $8,
            $9, $10, $11, $12, $13, $14
          )
          RETURNING id
        `,
        [
          email,
          username,
          displayName,
          firstName,
          lastName,
          passwordHash,
          role,
          status,
          locale,
          timezone,
          themeMode,
          totpRequired,
          passkeyEnabled,
          forcePasswordChange,
        ],
      );

      const userId = result.rows[0].id;

      await client.query(
        `
          INSERT INTO user_settings (user_id)
          VALUES ($1)
          ON CONFLICT (user_id) DO NOTHING
        `,
        [userId],
      );

      await writeAdminAudit(
        client,
        request,
        "admin.user.created",
        userId,
        {
          role,
          status,
          totpRequired,
          passkeyEnabled,
        },
      );

      const created = await loadAdminUser(userId, client);
      await client.query("COMMIT");

      response.status(201).json(mapAdminUser(created));
    } catch (error) {
      await client.query("ROLLBACK");

      if (error?.code === "23505") {
        throw conflict(
          "USER_ALREADY_EXISTS",
          "E-Mail-Adresse oder Anmeldename wird bereits verwendet.",
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }),
);

adminRoutes.get(
  "/users/:id",
  asyncHandler(async (request, response) => {
    const user = await loadAdminUser(uuidValue(request.params.id));

    if (!user) {
      throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
    }

    response.json(mapAdminUser(user));
  }),
);

async function updateAdminUser(request, response) {
  const userId = uuidValue(request.params.id);
  const current = await loadAdminUser(userId);

  if (!current) {
    throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
  }

  const body = objectBody(request.body);
  const email =
    body.email !== undefined
      ? emailField(body, "email", true)
      : current.email;
  const username =
    stringField(body, "loginName", {
      nullable: true,
      minimum: 3,
      maximum: 64,
    }) ??
    stringField(body, "username", {
      nullable: true,
      minimum: 3,
      maximum: 64,
    }) ??
    current.username;
  const displayName =
    body.displayName !== undefined
      ? stringField(body, "displayName", {
          required: true,
          minimum: 1,
          maximum: 120,
        })
      : current.display_name;
  const firstName =
    body.firstName !== undefined
      ? stringField(body, "firstName", {
          nullable: true,
          minimum: 1,
          maximum: 80,
        })
      : current.first_name;
  const lastName =
    body.lastName !== undefined
      ? stringField(body, "lastName", {
          nullable: true,
          minimum: 1,
          maximum: 80,
        })
      : current.last_name;
  const role = enumField(body, "role", ["user", "admin"]) ?? current.role;
  const status =
    enumField(body, "status", ["active", "disabled"]) ?? current.status;
  const locale =
    stringField(body, "locale", {
      minimum: 2,
      maximum: 16,
    }) ?? current.locale;
  const timezone =
    stringField(body, "timezone", {
      minimum: 1,
      maximum: 64,
    }) ?? current.timezone;
  const themeMode =
    enumField(body, "themeMode", ["light", "dark", "system"]) ??
    current.theme_mode;
  const forcePasswordChange =
    booleanField(body, "forcePasswordChange") ??
    current.force_password_change;
  const requestedTotpRequired =
    booleanField(body, "totpRequired") ?? current.totp_required;
  const passkeyEnabled =
    booleanField(body, "passkeyEnabled") ?? current.passkey_enabled;
  const requestedTotpEnabled = booleanField(body, "totpEnabled");
  const disableTotp = requestedTotpEnabled === false;

  if (requestedTotpEnabled === true && !current.totp_enabled) {
    throw badRequest(
      "TOTP_USER_SETUP_REQUIRED",
      "TOTP kann erst nach der Einrichtung und Code-Verifikation durch den Benutzer aktiviert werden.",
    );
  }

  if (
    userId === request.auth.userId &&
    (role !== "admin" || status !== "active")
  ) {
    throw badRequest(
      "SELF_ADMIN_PROTECTION",
      "Du kannst dein eigenes Administratorkonto nicht deaktivieren oder herabstufen.",
    );
  }

  const password = stringField(body, "password", {
    nullable: true,
    minimum: 8,
    maximum: 1024,
    trim: false,
  });
  const passwordHash = password ? await hashPassword(password) : null;

  if (!passkeyEnabled && !current.password_hash && !passwordHash) {
    throw badRequest(
      "LOGIN_METHOD_REQUIRED",
      "Passkeys können für ein Passkey-only-Konto erst deaktiviert werden, nachdem ein Passwort gesetzt wurde.",
    );
  }

  const totpRequired = disableTotp ? false : requestedTotpRequired;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        UPDATE users
        SET
          email = $2,
          username = $3,
          display_name = $4,
          first_name = $5,
          last_name = $6,
          role = $7,
          status = $8,
          locale = $9,
          timezone = $10,
          theme_mode = $11,
          force_password_change = $12,
          totp_required = $13,
          passkey_enabled = $14,
          password_hash = COALESCE($15, password_hash),
          password_changed_at = CASE
            WHEN $15 IS NULL THEN password_changed_at
            ELSE now()
          END,
          totp_enabled = CASE
            WHEN $16 THEN false
            ELSE totp_enabled
          END,
          totp_secret_encrypted = CASE
            WHEN $16 THEN NULL
            ELSE totp_secret_encrypted
          END
        WHERE id = $1
          AND deleted_at IS NULL
      `,
      [
        userId,
        email,
        username,
        displayName,
        firstName,
        lastName,
        role,
        status,
        locale,
        timezone,
        themeMode,
        forcePasswordChange,
        totpRequired,
        passkeyEnabled,
        passwordHash,
        disableTotp,
      ],
    );

    if (status === "disabled" || passwordHash || disableTotp) {
      const parameters = [userId];
      let currentSessionCondition = "";

      if (userId === request.auth.userId) {
        parameters.push(request.auth.sessionId);
        currentSessionCondition = "AND id <> $2";
      }

      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
            ${currentSessionCondition}
        `,
        parameters,
      );
    }

    await writeAdminAudit(
      client,
      request,
      "admin.user.updated",
      userId,
      {
        passwordChanged: Boolean(passwordHash),
        totpDisabled: disableTotp,
        totpRequired,
        passkeyEnabled,
        role,
        status,
      },
    );

    const updated = await loadAdminUser(userId, client);
    await client.query("COMMIT");

    response.json(mapAdminUser(updated));
  } catch (error) {
    await client.query("ROLLBACK");

    if (error?.code === "23505") {
      throw conflict(
        "USER_ALREADY_EXISTS",
        "E-Mail-Adresse oder Anmeldename wird bereits verwendet.",
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

adminRoutes.put("/users/:id", asyncHandler(updateAdminUser));
adminRoutes.patch("/users/:id", asyncHandler(updateAdminUser));

adminRoutes.delete(
  "/users/:id/totp",
  asyncHandler(async (request, response) => {
    const userId = uuidValue(request.params.id);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          UPDATE users
          SET
            totp_enabled = false,
            totp_required = false,
            totp_secret_encrypted = NULL
          WHERE id = $1
            AND deleted_at IS NULL
          RETURNING id
        `,
        [userId],
      );

      if (result.rowCount === 0) {
        throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
      }

      const parameters = [userId];
      let currentSessionCondition = "";

      if (userId === request.auth.userId) {
        parameters.push(request.auth.sessionId);
        currentSessionCondition = "AND id <> $2";
      }

      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
            ${currentSessionCondition}
        `,
        parameters,
      );

      await writeAdminAudit(
        client,
        request,
        "admin.user.totp_disabled",
        userId,
      );

      const updated = await loadAdminUser(userId, client);
      await client.query("COMMIT");
      response.json(mapAdminUser(updated));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

adminRoutes.delete(
  "/users/:id/passkeys",
  asyncHandler(async (request, response) => {
    const userId = uuidValue(request.params.id);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `
          SELECT password_hash
          FROM users
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE
        `,
        [userId],
      );

      if (userResult.rowCount === 0) {
        throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
      }

      if (!userResult.rows[0].password_hash) {
        throw badRequest(
          "LOGIN_METHOD_REQUIRED",
          "Bei einem Passkey-only-Konto muss zuerst ein Passwort gesetzt werden.",
        );
      }

      const deleted = await client.query(
        `DELETE FROM passkeys WHERE user_id = $1 RETURNING id`,
        [userId],
      );

      await writeAdminAudit(
        client,
        request,
        "admin.user.passkeys_deleted",
        userId,
        { deletedCount: deleted.rowCount },
      );

      const updated = await loadAdminUser(userId, client);
      await client.query("COMMIT");
      response.json(mapAdminUser(updated));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

adminRoutes.delete(
  "/users/:id/passkeys/:passkeyId",
  asyncHandler(async (request, response) => {
    const userId = uuidValue(request.params.id);
    const passkeyId = uuidValue(request.params.passkeyId, "passkeyId");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const statusResult = await client.query(
        `
          SELECT
            u.password_hash,
            (
              SELECT count(*)::integer
              FROM passkeys p
              WHERE p.user_id = u.id
            ) AS passkey_count
          FROM users u
          WHERE u.id = $1
            AND u.deleted_at IS NULL
          FOR UPDATE
        `,
        [userId],
      );

      const account = statusResult.rows[0];

      if (!account) {
        throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
      }

      if (!account.password_hash && Number(account.passkey_count) <= 1) {
        throw badRequest(
          "LOGIN_METHOD_REQUIRED",
          "Der letzte Passkey eines Passkey-only-Kontos kann nicht gelöscht werden.",
        );
      }

      const deleted = await client.query(
        `
          DELETE FROM passkeys
          WHERE id = $1
            AND user_id = $2
          RETURNING id
        `,
        [passkeyId, userId],
      );

      if (deleted.rowCount === 0) {
        throw notFound("PASSKEY_NOT_FOUND", "Der Passkey wurde nicht gefunden.");
      }

      await writeAdminAudit(
        client,
        request,
        "admin.user.passkey_deleted",
        userId,
        { passkeyId },
      );

      const updated = await loadAdminUser(userId, client);
      await client.query("COMMIT");
      response.json(mapAdminUser(updated));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

adminRoutes.delete(
  "/users/:id/sessions",
  asyncHandler(async (request, response) => {
    const userId = uuidValue(request.params.id);
    const user = await loadAdminUser(userId);

    if (!user) {
      throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
    }

    const parameters = [userId];
    let currentSessionCondition = "";

    if (userId === request.auth.userId) {
      parameters.push(request.auth.sessionId);
      currentSessionCondition = "AND id <> $2";
    }

    const result = await pool.query(
      `
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = $1
          AND revoked_at IS NULL
          ${currentSessionCondition}
        RETURNING id
      `,
      parameters,
    );

    await writeAdminAudit(
      pool,
      request,
      "admin.user.sessions_revoked",
      userId,
      { revokedCount: result.rowCount },
    );

    response.json({ revokedSessions: result.rowCount });
  }),
);

adminRoutes.delete(
  "/users/:id",
  asyncHandler(async (request, response) => {
    const userId = uuidValue(request.params.id);

    if (userId === request.auth.userId) {
      throw badRequest(
        "SELF_DELETE_FORBIDDEN",
        "Du kannst dein eigenes Administratorkonto nicht löschen.",
      );
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          UPDATE users
          SET
            deleted_at = now(),
            status = 'disabled',
            display_name = 'Gelöschter Benutzer',
            first_name = NULL,
            last_name = NULL,
            totp_enabled = false,
            totp_required = false,
            totp_secret_encrypted = NULL,
            passkey_enabled = false,
            email = email || '.deleted.' || id::text,
            username = username || '.deleted.' || id::text
          WHERE id = $1
            AND deleted_at IS NULL
          RETURNING id
        `,
        [userId],
      );

      if (result.rowCount === 0) {
        throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
      }

      await client.query(`DELETE FROM passkeys WHERE user_id = $1`, [userId]);
      await client.query(
        `
          UPDATE devices
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
        `,
        [userId],
      );
      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
        `,
        [userId],
      );

      await writeAdminAudit(
        client,
        request,
        "admin.user.deleted",
        userId,
      );

      await client.query("COMMIT");
      response.status(204).end();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

adminRoutes.get(
  "/settings/services",
  asyncHandler(async (_request, response) => {
    const settings = await getAdminServiceSettings();
    response.json({
      map: settings.map,
      photon: settings.photon,
      overpass: settings.overpass,
    });
  }),
);

adminRoutes.put(
  "/settings/services/map",
  asyncHandler(async (request, response) => {
    const value = parseMapSettings(request.body);
    const result = await writeSetting(
      "services.map",
      value,
      request.auth.userId,
      { isPublic: true },
    );
    response.json(result.value);
  }),
);

adminRoutes.put(
  "/settings/services/photon",
  asyncHandler(async (request, response) => {
    const value = parsePhotonSettings(request.body);
    const result = await writeSetting(
      "services.photon",
      value,
      request.auth.userId,
    );
    response.json(result.value);
  }),
);

adminRoutes.put(
  "/settings/services/overpass",
  asyncHandler(async (request, response) => {
    const value = parseOverpassSettings(request.body);
    const result = await writeSetting(
      "services.overpass",
      value,
      request.auth.userId,
    );
    response.json(result.value);
  }),
);

adminRoutes.post(
  "/settings/services/test",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const category = enumField(body, "category", ["map", "photon", "overpass"], {
      required: true,
    });
    const candidateConfig = objectBody(body.config);
    response.json(await testService(category, candidateConfig));
  }),
);

async function runBackup(jobId, requestedByUserId) {
  try {
    await fs.mkdir(config.backupDirectory, { recursive: true });
    await pool.query(
      `UPDATE backup_jobs SET status = 'running', started_at = now() WHERE id = $1`,
      [jobId],
    );

    const tableNames = [
      "users",
      "user_settings",
      "devices",
      "refresh_sessions",
      "password_reset_tokens",
      "passkeys",
      "pairing_requests",
      "vehicles",
      "trips",
      "track_points",
      "track_point_batches",
      "tags",
      "trip_tags",
      "sync_operations",
      "app_settings",
      "audit_log",
    ];
    const data = {
      format: "fahrtenbuch-json-backup-v1",
      createdAt: new Date().toISOString(),
      requestedByUserId,
      version: config.version,
      tables: {},
    };

    for (const tableName of tableNames) {
      const result = await pool.query(`SELECT * FROM ${tableName}`);
      data.tables[tableName] = result.rows;
    }

    const compressed = await gzipAsync(Buffer.from(JSON.stringify(data)));
    const fileName = `fahrtenbuch-backup-${new Date()
      .toISOString()
      .replaceAll(":", "-")}-${jobId}.json.gz`;
    const filePath = path.join(config.backupDirectory, fileName);
    await fs.writeFile(filePath, compressed, { mode: 0o600 });
    await pool.query(
      `
        UPDATE backup_jobs
        SET
          status = 'completed',
          file_name = $2,
          file_size_bytes = $3,
          completed_at = now()
        WHERE id = $1
      `,
      [jobId, fileName, compressed.length],
    );
  } catch (error) {
    console.error(`Backup ${jobId} fehlgeschlagen:`, error);
    await pool.query(
      `
        UPDATE backup_jobs
        SET
          status = 'failed',
          error_message = $2,
          completed_at = now()
        WHERE id = $1
      `,
      [jobId, String(error.message || error).slice(0, 5000)],
    );
  }
}

adminRoutes.post(
  "/backup",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
        INSERT INTO backup_jobs (requested_by_user_id)
        VALUES ($1)
        RETURNING id, status, created_at
      `,
      [request.auth.userId],
    );
    const job = result.rows[0];

    setImmediate(() => {
      runBackup(job.id, request.auth.userId).catch(console.error);
    });

    response.status(202).json({
      jobId: job.id,
      status: job.status,
      createdAt: job.created_at,
    });
  }),
);

adminRoutes.get(
  "/system",
  asyncHandler(async (_request, response) => {
    const [databaseResult, countsResult, migrationsResult, backupResult] =
      await Promise.all([
        pool.query(
          `
            SELECT
              current_database() AS database_name,
              version() AS postgres_version,
              pg_database_size(current_database()) AS database_size_bytes
          `,
        ),
        pool.query(
          `
            SELECT
              (SELECT count(*) FROM users WHERE deleted_at IS NULL) AS users,
              (SELECT count(*) FROM vehicles WHERE archived_at IS NULL) AS vehicles,
              (SELECT count(*) FROM trips WHERE archived_at IS NULL) AS trips,
              (SELECT count(*) FROM track_points) AS track_points
          `,
        ),
        pool.query(
          `
            SELECT filename, applied_at
            FROM schema_migrations
            ORDER BY filename
          `,
        ),
        pool.query(
          `
            SELECT id, status, file_name, file_size_bytes, error_message,
                   created_at, started_at, completed_at
            FROM backup_jobs
            ORDER BY created_at DESC
            LIMIT 10
          `,
        ),
      ]);

    response.json({
      application: {
        version: config.version,
        environment: config.env,
        buildDate: config.buildDate,
        vcsRef: config.vcsRef,
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        memory: process.memoryUsage(),
      },
      database: {
        name: databaseResult.rows[0].database_name,
        version: databaseResult.rows[0].postgres_version,
        sizeBytes: Number(databaseResult.rows[0].database_size_bytes),
      },
      counts: Object.fromEntries(
        Object.entries(countsResult.rows[0]).map(([key, value]) => [
          key,
          Number(value),
        ]),
      ),
      migrations: migrationsResult.rows,
      backups: backupResult.rows,
    });
  }),
);

// Kompatibilitätsendpunkte für die bereits erstellte Weboberfläche.
adminRoutes.get(
  "/overview",
  asyncHandler(async (_request, response) => {
    const result = await pool.query(
      `
        SELECT
          (SELECT count(*) FROM users WHERE deleted_at IS NULL) AS total_users,
          (SELECT count(*) FROM users WHERE deleted_at IS NULL AND status = 'active') AS active_users,
          (SELECT count(*) FROM users WHERE deleted_at IS NULL AND role = 'admin') AS admin_users,
          (SELECT count(*) FROM vehicles WHERE archived_at IS NULL) AS total_vehicles,
          (SELECT count(*) FROM trips WHERE archived_at IS NULL AND status = 'completed') AS total_trips,
          (SELECT coalesce(sum(distance_meters), 0) FROM trips WHERE archived_at IS NULL AND status = 'completed') AS total_distance_meters,
          pg_database_size(current_database()) AS database_size_bytes
      `,
    );
    const row = result.rows[0];
    response.json({
      totalUsers: Number(row.total_users),
      activeUsers: Number(row.active_users),
      adminUsers: Number(row.admin_users),
      totalVehicles: Number(row.total_vehicles),
      totalTrips: Number(row.total_trips),
      totalDistanceMeters: Number(row.total_distance_meters),
      databaseSizeBytes: Number(row.database_size_bytes),
      version: config.version,
    });
  }),
);

adminRoutes.get(
  "/settings",
  asyncHandler(async (_request, response) => {
    const result = await pool.query(
      `
        SELECT key, value
        FROM app_settings
        WHERE key IN ('tracking.defaults', 'pairing.expiresSeconds', 'map.defaults', 'mapMatching')
      `,
    );
    const values = Object.fromEntries(
      result.rows.map((row) => [row.key, row.value]),
    );
    response.json({
      trackingDefaults: values["tracking.defaults"] || {
        minimumDistanceMeters: 10,
        minimumTimeSeconds: 5,
      },
      pairingExpiresSeconds: Number(values["pairing.expiresSeconds"] || 120),
      mapDefaults: {
        provider: "osm",
        defaultLatitude: 50.1109,
        defaultLongitude: 8.6821,
        defaultZoom: 6,
        protomapsTileServerUrl: "",
        protomapsAssetsUrl: "",
        protomapsFlavor: "auto",
        ...(values["map.defaults"] || {}),
      },
      mapMatching: values["mapMatching"] || {
        provider: "disabled",
        osrmUrl: "",
        valhallaUrl: "",
      },
    });
  }),
);

adminRoutes.patch(
  "/settings",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);

    if (body.mapDefaults !== undefined) {
      body.mapDefaults = parseMapDefaultsSettings(body.mapDefaults);
    }

    if (body.mapMatching !== undefined) {
      body.mapMatching = parseMapMatchingSettings(body.mapMatching);
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const entries = [
        ["tracking.defaults", body.trackingDefaults],
        ["pairing.expiresSeconds", body.pairingExpiresSeconds],
        ["map.defaults", body.mapDefaults],
        ["mapMatching", body.mapMatching],
      ].filter(([, value]) => value !== undefined);

      for (const [key, value] of entries) {
        await client.query(
          `
            INSERT INTO app_settings (key, value, is_public, updated_by_user_id)
            VALUES ($1, $2::jsonb, true, $3)
            ON CONFLICT (key)
            DO UPDATE SET
              value = EXCLUDED.value,
              updated_by_user_id = EXCLUDED.updated_by_user_id
          `,
          [key, JSON.stringify(value), request.auth.userId],
        );
      }

      await client.query("COMMIT");
      request.method = "GET";
      const result = await pool.query(
        `SELECT key, value FROM app_settings WHERE key IN ('tracking.defaults', 'pairing.expiresSeconds', 'map.defaults', 'mapMatching')`,
      );
      const values = Object.fromEntries(
        result.rows.map((row) => [row.key, row.value]),
      );
      response.json({
        trackingDefaults: values["tracking.defaults"],
        pairingExpiresSeconds: Number(values["pairing.expiresSeconds"]),
        mapDefaults: values["map.defaults"],
        mapMatching: values["mapMatching"] || {
          provider: "disabled",
          osrmUrl: "",
          valhallaUrl: "",
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
