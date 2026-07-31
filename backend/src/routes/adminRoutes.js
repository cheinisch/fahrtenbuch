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

async function loadAdminUser(userId) {
  const result = await pool.query(
    `
      SELECT
        id,
        email,
        username,
        display_name,
        role,
        status,
        locale,
        timezone,
        theme_mode,
        totp_enabled,
        force_password_change,
        last_login_at,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] || null;
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
          u.role,
          u.status,
          u.locale,
          u.timezone,
          u.theme_mode,
          u.totp_enabled,
          u.force_password_change,
          u.last_login_at,
          u.created_at,
          u.updated_at,
          count(DISTINCT v.id)::integer AS vehicle_count,
          count(DISTINCT t.id)::integer AS trip_count
        FROM users u
        LEFT JOIN vehicles v
          ON v.user_id = u.id
          AND v.archived_at IS NULL
        LEFT JOIN trips t
          ON t.user_id = u.id
          AND t.archived_at IS NULL
        WHERE u.deleted_at IS NULL
        GROUP BY u.id
        ORDER BY u.role, lower(u.display_name), lower(u.email)
      `,
    );

    response.json(
      result.rows.map((row) => ({
        ...mapUser(row),
        vehicleCount: Number(row.vehicle_count || 0),
        tripCount: Number(row.trip_count || 0),
      })),
    );
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
    const displayName =
      stringField(body, "displayName", {
        nullable: true,
        maximum: 120,
      }) || email.split("@")[0];
    const role = enumField(body, "role", ["user", "admin"]) || "user";
    const forcePasswordChange =
      booleanField(body, "forcePasswordChange") ?? true;
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
            password_hash,
            password_changed_at,
            role,
            status,
            locale,
            timezone,
            theme_mode,
            force_password_change
          )
          VALUES (
            $1, $2, $3, $4, now(), $5,
            'active', 'de', 'Europe/Berlin', 'system', $6
          )
          RETURNING *
        `,
        [
          email,
          username,
          displayName,
          passwordHash,
          role,
          forcePasswordChange,
        ],
      );

      await client.query(
        `
          INSERT INTO user_settings (user_id)
          VALUES ($1)
          ON CONFLICT (user_id) DO NOTHING
        `,
        [result.rows[0].id],
      );

      await client.query(
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
          VALUES (
            $1,
            'admin.user.created',
            'user',
            $2,
            $3,
            NULL,
            $4,
            jsonb_build_object('role', $5)
          )
        `,
        [
          request.auth.userId,
          result.rows[0].id,
          request.requestId || null,
          request.get("user-agent") || null,
          role,
        ],
      );

      await client.query("COMMIT");
      response.status(201).json(mapUser(result.rows[0]));
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

    response.json(mapUser(user));
  }),
);

async function updateAdminUser(request, response) {
  const userId = uuidValue(request.params.id);
  const current = await loadAdminUser(userId);

  if (!current) {
    throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
  }

  const body = objectBody(request.body);
  const email = body.email ? emailField(body, "email", true) : current.email;
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
    stringField(body, "displayName", {
      nullable: true,
      maximum: 120,
    }) ?? current.display_name;
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
    booleanField(body, "forcePasswordChange") ?? current.force_password_change;

  if (
    userId === request.auth.userId &&
    (role !== "admin" || status !== "active")
  ) {
    throw badRequest(
      "SELF_ADMIN_PROTECTION",
      "Du kannst dein eigenes Administratorkonto nicht deaktivieren oder herabstufen.",
    );
  }

  let passwordHash = null;
  const password = stringField(body, "password", {
    nullable: true,
    minimum: 8,
    maximum: 1024,
    trim: false,
  });

  if (password) {
    passwordHash = await hashPassword(password);
  }

  try {
    const result = await pool.query(
      `
        UPDATE users
        SET
          email = $2,
          username = $3,
          display_name = $4,
          role = $5,
          status = $6,
          locale = $7,
          timezone = $8,
          theme_mode = $9,
          force_password_change = $10,
          password_hash = COALESCE($11, password_hash),
          password_changed_at = CASE
            WHEN $11 IS NULL THEN password_changed_at
            ELSE now()
          END
        WHERE id = $1
        RETURNING *
      `,
      [
        userId,
        email,
        username,
        displayName,
        role,
        status,
        locale,
        timezone,
        themeMode,
        forcePasswordChange,
        passwordHash,
      ],
    );

    if (status === "disabled" || passwordHash) {
      await pool.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
            ${userId === request.auth.userId ? "AND id <> $2" : ""}
        `,
        userId === request.auth.userId
          ? [userId, request.auth.sessionId]
          : [userId],
      );
    }

    response.json(mapUser(result.rows[0]));
  } catch (error) {
    if (error?.code === "23505") {
      throw conflict(
        "USER_ALREADY_EXISTS",
        "E-Mail-Adresse oder Anmeldename wird bereits verwendet.",
      );
    }

    throw error;
  }
}

adminRoutes.put("/users/:id", asyncHandler(updateAdminUser));
adminRoutes.patch("/users/:id", asyncHandler(updateAdminUser));

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

    const result = await pool.query(
      `
        UPDATE users
        SET
          deleted_at = now(),
          status = 'disabled',
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

    await pool.query(
      `
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = $1
      `,
      [userId],
    );

    response.status(204).end();
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
        WHERE key IN ('tracking.defaults', 'pairing.expiresSeconds', 'map.defaults')
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
      mapDefaults: values["map.defaults"] || {
        provider: "osm",
        defaultLatitude: 50.1109,
        defaultLongitude: 8.6821,
        defaultZoom: 6,
      },
    });
  }),
);

adminRoutes.patch(
  "/settings",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const entries = [
        ["tracking.defaults", body.trackingDefaults],
        ["pairing.expiresSeconds", body.pairingExpiresSeconds],
        ["map.defaults", body.mapDefaults],
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
        `SELECT key, value FROM app_settings WHERE key IN ('tracking.defaults', 'pairing.expiresSeconds', 'map.defaults')`,
      );
      const values = Object.fromEntries(
        result.rows.map((row) => [row.key, row.value]),
      );
      response.json({
        trackingDefaults: values["tracking.defaults"],
        pairingExpiresSeconds: Number(values["pairing.expiresSeconds"]),
        mapDefaults: values["map.defaults"],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
