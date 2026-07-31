import { Router } from "express";

import { pool } from "../database/pool.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const adminRoutes = Router();

adminRoutes.use(requireAuth);
adminRoutes.use(requireAdmin);

function sendError(response, status, code, message) {
  return response.status(status).json({
    error: {
      code,
      message,
    },
  });
}

function toNumber(value) {
  return Number(value || 0);
}

async function readSystemSettings() {
  const result = await pool.query(
    `
      SELECT key, value
      FROM app_settings
      WHERE key IN (
        'tracking.defaults',
        'pairing.expiresSeconds',
        'map.defaults'
      )
    `,
  );

  const values = Object.fromEntries(
    result.rows.map((row) => [row.key, row.value]),
  );

  return {
    trackingDefaults:
      values["tracking.defaults"] || {
        minimumDistanceMeters: 10,
        minimumTimeSeconds: 5,
      },
    pairingExpiresSeconds:
      Number(values["pairing.expiresSeconds"] ?? 120),
    mapDefaults:
      values["map.defaults"] || {
        provider: "osm",
        defaultLatitude: 50.1109,
        defaultLongitude: 8.6821,
        defaultZoom: 6,
      },
  };
}

adminRoutes.get("/overview", async (request, response, next) => {
  try {
    const [usersResult, vehiclesResult, tripsResult, dbResult] =
      await Promise.all([
        pool.query(
          `
            SELECT
              count(*) FILTER (
                WHERE deleted_at IS NULL
              )::integer AS total_users,
              count(*) FILTER (
                WHERE deleted_at IS NULL
                  AND status = 'active'
              )::integer AS active_users,
              count(*) FILTER (
                WHERE deleted_at IS NULL
                  AND role = 'admin'
              )::integer AS admin_users
            FROM users
          `,
        ),
        pool.query(
          `
            SELECT count(*)::integer AS total_vehicles
            FROM vehicles
            WHERE archived_at IS NULL
          `,
        ),
        pool.query(
          `
            SELECT
              count(*)::integer AS total_trips,
              coalesce(sum(distance_meters), 0)
                AS total_distance_meters
            FROM trips
            WHERE archived_at IS NULL
              AND status = 'completed'
          `,
        ),
        pool.query(
          `
            SELECT pg_database_size(
              current_database()
            ) AS database_size_bytes
          `,
        ),
      ]);

    response.json({
      totalUsers:
        toNumber(usersResult.rows[0].total_users),
      activeUsers:
        toNumber(usersResult.rows[0].active_users),
      adminUsers:
        toNumber(usersResult.rows[0].admin_users),
      totalVehicles:
        toNumber(vehiclesResult.rows[0].total_vehicles),
      totalTrips:
        toNumber(tripsResult.rows[0].total_trips),
      totalDistanceMeters:
        toNumber(
          tripsResult.rows[0].total_distance_meters,
        ),
      databaseSizeBytes:
        toNumber(dbResult.rows[0].database_size_bytes),
      version:
        process.env.APP_VERSION || "dev",
    });
  } catch (error) {
    next(error);
  }
});

adminRoutes.get("/users", async (request, response, next) => {
  try {
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
          count(DISTINCT v.id)::integer
            AS vehicle_count,
          count(DISTINCT t.id)::integer
            AS trip_count
        FROM users u
        LEFT JOIN vehicles v
          ON v.user_id = u.id
          AND v.archived_at IS NULL
        LEFT JOIN trips t
          ON t.user_id = u.id
          AND t.archived_at IS NULL
        WHERE u.deleted_at IS NULL
        GROUP BY u.id
        ORDER BY
          u.role ASC,
          lower(u.display_name),
          lower(u.email)
      `,
    );

    response.json(
      result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        locale: row.locale,
        timezone: row.timezone,
        themeMode: row.theme_mode,
        totpEnabled: row.totp_enabled,
        forcePasswordChange:
          row.force_password_change,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        vehicleCount: toNumber(row.vehicle_count),
        tripCount: toNumber(row.trip_count),
      })),
    );
  } catch (error) {
    next(error);
  }
});

adminRoutes.patch(
  "/users/:userId",
  async (request, response, next) => {
    try {
      const targetResult = await pool.query(
        `
          SELECT id, role, status
          FROM users
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [request.params.userId],
      );

      const target = targetResult.rows[0];

      if (!target) {
        return sendError(
          response,
          404,
          "USER_NOT_FOUND",
          "Der Benutzer wurde nicht gefunden.",
        );
      }

      const role =
        request.body?.role ?? target.role;
      const status =
        request.body?.status ?? target.status;
      const forcePasswordChange =
        request.body?.forcePasswordChange === undefined
          ? undefined
          : Boolean(
              request.body.forcePasswordChange,
            );

      if (!["admin", "user"].includes(role)) {
        return sendError(
          response,
          400,
          "INVALID_ROLE",
          "Die Rolle ist ungültig.",
        );
      }

      if (!["active", "disabled"].includes(status)) {
        return sendError(
          response,
          400,
          "INVALID_STATUS",
          "Der Benutzerstatus ist ungültig.",
        );
      }

      if (
        target.id === request.auth.userId &&
        (role !== "admin" || status !== "active")
      ) {
        return sendError(
          response,
          400,
          "SELF_ADMIN_PROTECTION",
          "Du kannst dein eigenes Administratorkonto nicht deaktivieren oder herabstufen.",
        );
      }

      const result = await pool.query(
        `
          UPDATE users
          SET
            role = $2,
            status = $3,
            force_password_change =
              COALESCE($4, force_password_change)
          WHERE id = $1
          RETURNING
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
        `,
        [
          target.id,
          role,
          status,
          forcePasswordChange,
        ],
      );

      await pool.query(
        `
          INSERT INTO audit_log (
            actor_user_id,
            action,
            entity_type,
            entity_id,
            metadata
          )
          VALUES (
            $1,
            'admin.user_updated',
            'user',
            $2,
            $3::jsonb
          )
        `,
        [
          request.auth.userId,
          target.id,
          JSON.stringify({
            role,
            status,
            forcePasswordChange,
          }),
        ],
      );

      const row = result.rows[0];

      response.json({
        id: row.id,
        email: row.email,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        locale: row.locale,
        timezone: row.timezone,
        themeMode: row.theme_mode,
        totpEnabled: row.totp_enabled,
        forcePasswordChange:
          row.force_password_change,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRoutes.get("/settings", async (request, response, next) => {
  try {
    response.json(await readSystemSettings());
  } catch (error) {
    next(error);
  }
});

adminRoutes.patch(
  "/settings",
  async (request, response, next) => {
    try {
      const current = await readSystemSettings();

      const trackingDefaults = {
        ...current.trackingDefaults,
        ...(request.body?.trackingDefaults || {}),
      };

      const pairingExpiresSeconds = Number(
        request.body?.pairingExpiresSeconds ??
          current.pairingExpiresSeconds,
      );

      const mapDefaults = {
        ...current.mapDefaults,
        ...(request.body?.mapDefaults || {}),
      };

      if (
        !Number.isFinite(
          Number(trackingDefaults.minimumDistanceMeters),
        ) ||
        Number(trackingDefaults.minimumDistanceMeters) < 0
      ) {
        return sendError(
          response,
          400,
          "INVALID_MINIMUM_DISTANCE",
          "Der minimale Abstand ist ungültig.",
        );
      }

      if (
        !Number.isFinite(
          Number(trackingDefaults.minimumTimeSeconds),
        ) ||
        Number(trackingDefaults.minimumTimeSeconds) < 0
      ) {
        return sendError(
          response,
          400,
          "INVALID_MINIMUM_TIME",
          "Das minimale Zeitintervall ist ungültig.",
        );
      }

      if (
        !Number.isInteger(pairingExpiresSeconds) ||
        pairingExpiresSeconds < 30 ||
        pairingExpiresSeconds > 900
      ) {
        return sendError(
          response,
          400,
          "INVALID_PAIRING_EXPIRY",
          "Die Pairing-Gültigkeit muss zwischen 30 und 900 Sekunden liegen.",
        );
      }

      if (
        !mapDefaults.provider ||
        !Number.isFinite(
          Number(mapDefaults.defaultLatitude),
        ) ||
        Number(mapDefaults.defaultLatitude) < -90 ||
        Number(mapDefaults.defaultLatitude) > 90 ||
        !Number.isFinite(
          Number(mapDefaults.defaultLongitude),
        ) ||
        Number(mapDefaults.defaultLongitude) < -180 ||
        Number(mapDefaults.defaultLongitude) > 180 ||
        !Number.isInteger(
          Number(mapDefaults.defaultZoom),
        ) ||
        Number(mapDefaults.defaultZoom) < 0 ||
        Number(mapDefaults.defaultZoom) > 22
      ) {
        return sendError(
          response,
          400,
          "INVALID_MAP_DEFAULTS",
          "Die Standardwerte der Karte sind ungültig.",
        );
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const entries = [
          [
            "tracking.defaults",
            {
              minimumDistanceMeters: Number(
                trackingDefaults.minimumDistanceMeters,
              ),
              minimumTimeSeconds: Number(
                trackingDefaults.minimumTimeSeconds,
              ),
            },
            true,
          ],
          [
            "pairing.expiresSeconds",
            pairingExpiresSeconds,
            true,
          ],
          [
            "map.defaults",
            {
              provider: String(mapDefaults.provider),
              defaultLatitude: Number(
                mapDefaults.defaultLatitude,
              ),
              defaultLongitude: Number(
                mapDefaults.defaultLongitude,
              ),
              defaultZoom: Number(
                mapDefaults.defaultZoom,
              ),
            },
            true,
          ],
        ];

        for (const [key, value, isPublic] of entries) {
          await client.query(
            `
              INSERT INTO app_settings (
                key,
                value,
                is_public,
                updated_by_user_id
              )
              VALUES ($1, $2::jsonb, $3, $4)
              ON CONFLICT (key)
              DO UPDATE SET
                value = EXCLUDED.value,
                is_public = EXCLUDED.is_public,
                updated_by_user_id =
                  EXCLUDED.updated_by_user_id
            `,
            [
              key,
              JSON.stringify(value),
              isPublic,
              request.auth.userId,
            ],
          );
        }

        await client.query(
          `
            INSERT INTO audit_log (
              actor_user_id,
              action,
              entity_type,
              metadata
            )
            VALUES (
              $1,
              'admin.settings_updated',
              'app_settings',
              $2::jsonb
            )
          `,
          [
            request.auth.userId,
            JSON.stringify({
              trackingDefaults,
              pairingExpiresSeconds,
              mapDefaults,
            }),
          ],
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      response.json(await readSystemSettings());
    } catch (error) {
      next(error);
    }
  },
);
