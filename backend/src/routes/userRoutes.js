import { Router } from "express";

import { pool } from "../database/pool.js";
import {
  badRequest,
  conflict,
  notFound,
} from "../lib/errors.js";
import {
  mapDevice,
  mapUser,
} from "../lib/mappers.js";
import {
  emailField,
  enumField,
  integerField,
  numberField,
  objectBody,
  stringField,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import {
  photonReverse,
  photonSearch,
} from "../services/geocodingService.js";
import {
  getUserSettings,
  updateUserSettings,
} from "../services/userSettingsService.js";
import { USER_PUBLIC_COLUMNS } from "../users/userMapper.js";

export const userRoutes = Router();

userRoutes.use(requireAuth);

async function getUser(userId) {
  const result = await pool.query(
    `
      SELECT ${USER_PUBLIC_COLUMNS}
      FROM users u
      WHERE u.id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

async function updateProfile(request, response) {
  const body = objectBody(request.body);
  const current = await getUser(request.auth.userId);

  if (!current) {
    throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
  }

  const loginName =
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
    enumField(body, "themeMode", ["light", "dark", "system"], {
      nullable: false,
    }) ?? current.theme_mode;

  const email = body.email
    ? emailField(body, "email", true)
    : current.email;

  try {
    const result = await pool.query(
      `
        UPDATE users
        SET
          email = $2,
          username = $3,
          display_name = $4,
          first_name = $5,
          last_name = $6,
          locale = $7,
          timezone = $8,
          theme_mode = $9
        WHERE id = $1
        RETURNING
          id,
          email,
          username,
          display_name,
          first_name,
          last_name,
          role,
          status,
          locale,
          timezone,
          theme_mode,
          totp_enabled,
          totp_required,
          passkey_enabled,
          (password_hash IS NOT NULL) AS has_password,
          force_password_change,
          last_login_at,
          created_at,
          updated_at
      `,
      [
        request.auth.userId,
        email,
        loginName,
        displayName,
        firstName,
        lastName,
        locale,
        timezone,
        themeMode,
      ],
    );

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

async function changePassword(request, response) {
  const body = objectBody(request.body);
  const currentPassword = stringField(body, "currentPassword", {
    required: true,
    minimum: 1,
    maximum: 1024,
    trim: false,
  });
  const newPassword = stringField(body, "newPassword", {
    required: true,
    minimum: 8,
    maximum: 1024,
    trim: false,
  });

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

  if (
    !result.rows[0]?.password_hash ||
    !(await verifyPassword(currentPassword, result.rows[0].password_hash))
  ) {
    throw badRequest(
      "CURRENT_PASSWORD_INVALID",
      "Das aktuelle Passwort ist nicht korrekt.",
    );
  }

  const passwordHash = await hashPassword(newPassword);
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
      [request.auth.userId, passwordHash],
    );
    await client.query(
      `
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = $1
          AND id <> $2
      `,
      [request.auth.userId, request.auth.sessionId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  response.json({ changed: true });
}

userRoutes.get(
  "/me",
  asyncHandler(async (request, response) => {
    const user = await getUser(request.auth.userId);

    if (!user) {
      throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
    }

    response.json(mapUser(user));
  }),
);

userRoutes.put("/me", asyncHandler(updateProfile));
userRoutes.patch("/me/profile", asyncHandler(updateProfile));
userRoutes.put("/me/password", asyncHandler(changePassword));
userRoutes.post("/me/password", asyncHandler(changePassword));

userRoutes.get(
  "/me/devices",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
        SELECT
          d.*,
          EXISTS (
            SELECT 1
            FROM refresh_sessions rs
            WHERE rs.id = $2
              AND rs.device_id = d.id
          ) AS is_current
        FROM devices d
        WHERE d.user_id = $1
          AND d.revoked_at IS NULL
        ORDER BY
          d.last_seen_at DESC NULLS LAST,
          d.created_at DESC
      `,
      [request.auth.userId, request.auth.sessionId],
    );

    response.json(result.rows.map(mapDevice));
  }),
);

userRoutes.delete(
  "/me/devices/:deviceId",
  asyncHandler(async (request, response) => {
    const deviceId = String(request.params.deviceId || "");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `
          SELECT d.id
          FROM devices d
          WHERE d.user_id = $1
            AND (d.id::text = $2 OR d.external_id = $2)
          LIMIT 1
          FOR UPDATE
        `,
        [request.auth.userId, deviceId],
      );

      const internalId = result.rows[0]?.id;

      if (!internalId) {
        throw notFound("DEVICE_NOT_FOUND", "Das Gerät wurde nicht gefunden.");
      }

      if (internalId === request.auth.deviceId) {
        throw badRequest(
          "CURRENT_DEVICE",
          "Das aktuell verwendete Gerät kann hier nicht entfernt werden.",
        );
      }

      await client.query(
        `UPDATE devices SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1`,
        [internalId],
      );
      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE device_id = $1
        `,
        [internalId],
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

userRoutes.get(
  "/me/settings",
  asyncHandler(async (request, response) => {
    const [user, settings] = await Promise.all([
      getUser(request.auth.userId),
      getUserSettings(request.auth.userId),
    ]);

    response.json({
      user: mapUser(user),
      settings,
    });
  }),
);

userRoutes.patch(
  "/me/settings",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);

    if (
      body.trackingAccuracyMode !== undefined &&
      !["high", "balanced", "battery"].includes(body.trackingAccuracyMode)
    ) {
      throw badRequest(
        "VALIDATION_ERROR",
        "Der Genauigkeitsmodus ist ungültig.",
      );
    }

    if (body.stopDelaySeconds !== undefined) {
      integerField(body, "stopDelaySeconds", {
        minimum: 0,
        maximum: 3600,
      });
    }

    if (body.locationRecognitionRadiusMeters !== undefined) {
      integerField(body, "locationRecognitionRadiusMeters", {
        minimum: 25,
        maximum: 5000,
      });
    }

    response.json(
      await updateUserSettings(request.auth.userId, body),
    );
  }),
);

userRoutes.post(
  "/me/home-location/search",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const query = stringField(body, "query", {
      required: true,
      minimum: 3,
      maximum: 250,
    });
    const result = await photonSearch(query, body.language || "de", 6);

    response.json({
      candidates: result.results.map((entry) => ({
        address: entry.address,
        latitude: entry.latitude,
        longitude: entry.longitude,
        source: "manual",
      })),
    });
  }),
);

userRoutes.post(
  "/me/home-location/reverse",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const latitude = numberField(body, "latitude", {
      required: true,
      minimum: -90,
      maximum: 90,
    });
    const longitude = numberField(body, "longitude", {
      required: true,
      minimum: -180,
      maximum: 180,
    });
    const result = await photonReverse(latitude, longitude, body.language || "de");

    response.json({
      candidate: {
        address:
          result.result?.address ||
          `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        latitude,
        longitude,
        source: "gps",
      },
    });
  }),
);

userRoutes.put(
  "/me/home-location",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const address = stringField(body, "address", {
      required: true,
      minimum: 1,
      maximum: 500,
    });
    const latitude = numberField(body, "latitude", {
      required: true,
      minimum: -90,
      maximum: 90,
    });
    const longitude = numberField(body, "longitude", {
      required: true,
      minimum: -180,
      maximum: 180,
    });
    const source = enumField(body, "source", ["manual", "gps"], {
      required: true,
    });

    const settings = await updateUserSettings(request.auth.userId, {
      homeLocation: {
        address,
        latitude,
        longitude,
        source,
        updatedAt: new Date().toISOString(),
      },
    });

    response.json({ homeLocation: settings.homeLocation });
  }),
);

userRoutes.delete(
  "/me/home-location",
  asyncHandler(async (request, response) => {
    await pool.query(
      `
        UPDATE user_settings
        SET settings = COALESCE(settings, '{}'::jsonb) - 'homeLocation'
        WHERE user_id = $1
      `,
      [request.auth.userId],
    );

    response.status(204).end();
  }),
);


userRoutes.put(
  "/me/work-location",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const address = stringField(body, "address", {
      required: true,
      minimum: 1,
      maximum: 500,
    });
    const latitude = numberField(body, "latitude", {
      required: true,
      minimum: -90,
      maximum: 90,
    });
    const longitude = numberField(body, "longitude", {
      required: true,
      minimum: -180,
      maximum: 180,
    });
    const source = enumField(body, "source", ["manual", "gps"], {
      required: true,
    });

    const settings = await updateUserSettings(request.auth.userId, {
      workLocation: {
        address,
        latitude,
        longitude,
        source,
        updatedAt: new Date().toISOString(),
      },
    });

    response.json({ workLocation: settings.workLocation });
  }),
);

userRoutes.delete(
  "/me/work-location",
  asyncHandler(async (request, response) => {
    await pool.query(
      `
        UPDATE user_settings
        SET settings = COALESCE(settings, '{}'::jsonb) - 'workLocation'
        WHERE user_id = $1
      `,
      [request.auth.userId],
    );

    response.status(204).end();
  }),
);
