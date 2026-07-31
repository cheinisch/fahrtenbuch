import { Router } from "express";

import { pool } from "../database/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import {
  mapUser,
  USER_PUBLIC_COLUMNS,
} from "../users/userMapper.js";

export const userRoutes = Router();

userRoutes.use(requireAuth);

function sendError(response, status, code, message) {
  return response.status(status).json({
    error: {
      code,
      message,
    },
  });
}

function mapSettings(row) {
  return {
    automaticTrackingEnabled:
      row.automatic_tracking_enabled ?? false,
    trackingAccuracyMode:
      row.tracking_accuracy_mode || "balanced",
    stopDelaySeconds:
      Number(row.stop_delay_seconds ?? 180),
    saveAccuracy:
      row.save_accuracy ?? true,
    mapProvider:
      row.map_provider || "osm",
    customSettings:
      row.settings || {},
    createdAt:
      row.settings_created_at || null,
    updatedAt:
      row.settings_updated_at || null,
  };
}

async function loadUserAndSettings(userId) {
  const result = await pool.query(
    `
      SELECT
        ${USER_PUBLIC_COLUMNS},
        us.automatic_tracking_enabled,
        us.tracking_accuracy_mode,
        us.stop_delay_seconds,
        us.save_accuracy,
        us.map_provider,
        us.settings,
        us.created_at AS settings_created_at,
        us.updated_at AS settings_updated_at
      FROM users u
      LEFT JOIN user_settings us
        ON us.user_id = u.id
      WHERE u.id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

userRoutes.get("/me", async (request, response, next) => {
  try {
    const result = await pool.query(
      `
        SELECT ${USER_PUBLIC_COLUMNS}
        FROM users u
        WHERE u.id = $1
          AND u.status = 'active'
          AND u.deleted_at IS NULL
        LIMIT 1
      `,
      [request.auth.userId],
    );

    if (result.rowCount === 0) {
      return sendError(
        response,
        404,
        "USER_NOT_FOUND",
        "Der Benutzer wurde nicht gefunden.",
      );
    }

    response.json(mapUser(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

userRoutes.get("/me/settings", async (request, response, next) => {
  try {
    const row = await loadUserAndSettings(request.auth.userId);

    if (!row) {
      return sendError(
        response,
        404,
        "USER_NOT_FOUND",
        "Der Benutzer wurde nicht gefunden.",
      );
    }

    response.json({
      user: mapUser(row),
      settings: mapSettings(row),
    });
  } catch (error) {
    next(error);
  }
});

userRoutes.patch("/me/profile", async (request, response, next) => {
  try {
    const currentResult = await pool.query(
      `
        SELECT *
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [request.auth.userId],
    );

    const current = currentResult.rows[0];

    if (!current) {
      return sendError(
        response,
        404,
        "USER_NOT_FOUND",
        "Der Benutzer wurde nicht gefunden.",
      );
    }

    const email = String(
      request.body?.email ?? current.email,
    )
      .trim()
      .toLowerCase();

    const username = String(
      request.body?.username ?? current.username,
    ).trim();

    const displayName = String(
      request.body?.displayName ?? current.display_name,
    ).trim();

    const locale = String(
      request.body?.locale ?? current.locale,
    ).trim();

    const timezone = String(
      request.body?.timezone ?? current.timezone,
    ).trim();

    const themeMode = String(
      request.body?.themeMode ?? current.theme_mode,
    ).trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(
        response,
        400,
        "INVALID_EMAIL",
        "Bitte gib eine gültige E-Mail-Adresse ein.",
      );
    }

    if (username.length < 3 || username.length > 64) {
      return sendError(
        response,
        400,
        "INVALID_USERNAME",
        "Der Benutzername muss zwischen 3 und 64 Zeichen lang sein.",
      );
    }

    if (displayName.length < 1 || displayName.length > 120) {
      return sendError(
        response,
        400,
        "INVALID_DISPLAY_NAME",
        "Der Anzeigename muss zwischen 1 und 120 Zeichen lang sein.",
      );
    }

    if (locale.length < 2 || locale.length > 16) {
      return sendError(
        response,
        400,
        "INVALID_LOCALE",
        "Die Spracheinstellung ist ungültig.",
      );
    }

    if (timezone.length < 1 || timezone.length > 64) {
      return sendError(
        response,
        400,
        "INVALID_TIMEZONE",
        "Die Zeitzone ist ungültig.",
      );
    }

    if (!["light", "dark", "system"].includes(themeMode)) {
      return sendError(
        response,
        400,
        "INVALID_THEME",
        "Der ausgewählte Darstellungsmodus ist ungültig.",
      );
    }

    const result = await pool.query(
      `
        UPDATE users
        SET
          email = $2,
          username = $3,
          display_name = $4,
          locale = $5,
          timezone = $6,
          theme_mode = $7
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
        request.auth.userId,
        email,
        username,
        displayName,
        locale,
        timezone,
        themeMode,
      ],
    );

    response.json(mapUser(result.rows[0]));
  } catch (error) {
    if (error?.code === "23505") {
      return sendError(
        response,
        409,
        "USER_ALREADY_EXISTS",
        "E-Mail-Adresse oder Benutzername wird bereits verwendet.",
      );
    }

    next(error);
  }
});

userRoutes.patch("/me/settings", async (request, response, next) => {
  try {
    const automaticTrackingEnabled =
      Boolean(request.body?.automaticTrackingEnabled);

    const trackingAccuracyMode = String(
      request.body?.trackingAccuracyMode || "balanced",
    );

    const stopDelaySeconds = Number(
      request.body?.stopDelaySeconds ?? 180,
    );

    const saveAccuracy =
      request.body?.saveAccuracy !== false;

    const mapProvider = String(
      request.body?.mapProvider || "osm",
    ).trim();

    if (
      !["high", "balanced", "battery"].includes(
        trackingAccuracyMode,
      )
    ) {
      return sendError(
        response,
        400,
        "INVALID_ACCURACY_MODE",
        "Der Genauigkeitsmodus ist ungültig.",
      );
    }

    if (
      !Number.isInteger(stopDelaySeconds) ||
      stopDelaySeconds < 0 ||
      stopDelaySeconds > 3600
    ) {
      return sendError(
        response,
        400,
        "INVALID_STOP_DELAY",
        "Die Stop-Verzögerung muss zwischen 0 und 3600 Sekunden liegen.",
      );
    }

    if (!mapProvider || mapProvider.length > 64) {
      return sendError(
        response,
        400,
        "INVALID_MAP_PROVIDER",
        "Der Kartenanbieter ist ungültig.",
      );
    }

    const result = await pool.query(
      `
        INSERT INTO user_settings (
          user_id,
          automatic_tracking_enabled,
          tracking_accuracy_mode,
          stop_delay_seconds,
          save_accuracy,
          map_provider
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id)
        DO UPDATE SET
          automatic_tracking_enabled =
            EXCLUDED.automatic_tracking_enabled,
          tracking_accuracy_mode =
            EXCLUDED.tracking_accuracy_mode,
          stop_delay_seconds =
            EXCLUDED.stop_delay_seconds,
          save_accuracy =
            EXCLUDED.save_accuracy,
          map_provider =
            EXCLUDED.map_provider
        RETURNING
          automatic_tracking_enabled,
          tracking_accuracy_mode,
          stop_delay_seconds,
          save_accuracy,
          map_provider,
          settings,
          created_at AS settings_created_at,
          updated_at AS settings_updated_at
      `,
      [
        request.auth.userId,
        automaticTrackingEnabled,
        trackingAccuracyMode,
        stopDelaySeconds,
        saveAccuracy,
        mapProvider,
      ],
    );

    response.json(mapSettings(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

userRoutes.post("/me/password", async (request, response, next) => {
  try {
    const currentPassword = String(
      request.body?.currentPassword || "",
    );

    const newPassword = String(
      request.body?.newPassword || "",
    );

    const result = await pool.query(
      `
        SELECT password_hash
        FROM users
        WHERE id = $1
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [request.auth.userId],
    );

    const user = result.rows[0];

    if (
      !user ||
      !user.password_hash ||
      !(await verifyPassword(
        currentPassword,
        user.password_hash,
      ))
    ) {
      return sendError(
        response,
        401,
        "CURRENT_PASSWORD_INVALID",
        "Das aktuelle Passwort ist nicht korrekt.",
      );
    }

    const newPasswordHash =
      await hashPassword(newPassword);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
          UPDATE users
          SET
            password_hash = $2,
            password_changed_at = now(),
            force_password_change = false
          WHERE id = $1
        `,
        [request.auth.userId, newPasswordHash],
      );

      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
            AND id <> $2
        `,
        [
          request.auth.userId,
          request.auth.sessionId,
        ],
      );

      await client.query(
        `
          INSERT INTO audit_log (
            actor_user_id,
            action,
            entity_type,
            entity_id
          )
          VALUES ($1, 'user.password_changed', 'user', $1)
        `,
        [request.auth.userId],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

userRoutes.get("/me/devices", async (request, response, next) => {
  try {
    const result = await pool.query(
      `
        SELECT
          d.id,
          d.device_name,
          d.device_type,
          d.platform,
          d.app_version,
          d.last_seen_at,
          d.created_at,
          d.revoked_at,
          EXISTS (
            SELECT 1
            FROM refresh_sessions rs
            WHERE rs.id = $2
              AND rs.device_id = d.id
          ) AS is_current
        FROM devices d
        WHERE d.user_id = $1
        ORDER BY
          d.revoked_at NULLS FIRST,
          d.last_seen_at DESC NULLS LAST,
          d.created_at DESC
      `,
      [
        request.auth.userId,
        request.auth.sessionId,
      ],
    );

    response.json(
      result.rows.map((row) => ({
        id: row.id,
        deviceName: row.device_name,
        deviceType: row.device_type,
        platform: row.platform,
        appVersion: row.app_version,
        lastSeenAt: row.last_seen_at,
        createdAt: row.created_at,
        revokedAt: row.revoked_at,
        isCurrent: row.is_current,
      })),
    );
  } catch (error) {
    next(error);
  }
});

userRoutes.delete(
  "/me/devices/:deviceId",
  async (request, response, next) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const currentDeviceResult = await client.query(
        `
          SELECT device_id
          FROM refresh_sessions
          WHERE id = $1
          LIMIT 1
        `,
        [request.auth.sessionId],
      );

      if (
        currentDeviceResult.rows[0]?.device_id ===
        request.params.deviceId
      ) {
        await client.query("ROLLBACK");

        return sendError(
          response,
          400,
          "CURRENT_DEVICE",
          "Das aktuell verwendete Gerät kann hier nicht entfernt werden.",
        );
      }

      const deviceResult = await client.query(
        `
          UPDATE devices
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE id = $1
            AND user_id = $2
          RETURNING id
        `,
        [
          request.params.deviceId,
          request.auth.userId,
        ],
      );

      if (deviceResult.rowCount === 0) {
        await client.query("ROLLBACK");

        return sendError(
          response,
          404,
          "DEVICE_NOT_FOUND",
          "Das Gerät wurde nicht gefunden.",
        );
      }

      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE device_id = $1
            AND user_id = $2
        `,
        [
          request.params.deviceId,
          request.auth.userId,
        ],
      );

      await client.query("COMMIT");
      response.status(204).end();
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);
