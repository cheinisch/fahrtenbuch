import { randomUUID } from "node:crypto";
import { Router } from "express";
import { pool } from "../database/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { verifyPassword } from "../security/password.js";
import { verifyTotp } from "../security/totp.js";
import {
  createAccessToken,
  createRefreshToken,
  getAccessTokenExpiration,
  getRefreshExpiration,
  hashToken,
} from "../security/tokens.js";
import {
  mapUser,
  USER_PUBLIC_COLUMNS,
} from "../users/userMapper.js";

export const authRoutes = Router();

function sendError(response, status, code, message) {
  return response.status(status).json({
    error: {
      code,
      message,
    },
  });
}

function createTokenResponse(
  accessToken,
  refreshToken,
  refreshExpiresAt,
) {
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt:
      getAccessTokenExpiration(accessToken).toISOString(),
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
  };
}

authRoutes.post("/login", async (request, response, next) => {
  try {
    const email = String(request.body?.email || "")
      .trim()
      .toLowerCase();

    const password = String(request.body?.password || "");
    const totpCode = request.body?.totpCode;
    const deviceName =
      String(request.body?.deviceName || "Webbrowser")
        .trim()
        .slice(0, 120) || "Webbrowser";

    if (!email || !password) {
      return sendError(
        response,
        400,
        "VALIDATION_ERROR",
        "E-Mail-Adresse und Passwort sind erforderlich.",
      );
    }

    const result = await pool.query(
      `
        SELECT
          ${USER_PUBLIC_COLUMNS},
          u.password_hash,
          u.totp_secret_encrypted
        FROM users u
        WHERE lower(u.email) = lower($1)
          AND u.deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    );

    const databaseUser = result.rows[0];

    const passwordValid =
      databaseUser?.password_hash &&
      (await verifyPassword(
        password,
        databaseUser.password_hash,
      ));

    if (
      !databaseUser ||
      !passwordValid ||
      databaseUser.status !== "active"
    ) {
      return sendError(
        response,
        401,
        "INVALID_CREDENTIALS",
        "E-Mail-Adresse oder Passwort ist falsch.",
      );
    }

    if (databaseUser.totp_enabled) {
      if (!totpCode) {
        return sendError(
          response,
          401,
          "MFA_REQUIRED",
          "Bitte gib deinen Zwei-Faktor-Code ein.",
        );
      }

      if (
        !databaseUser.totp_secret_encrypted ||
        !verifyTotp(
          databaseUser.totp_secret_encrypted,
          totpCode,
        )
      ) {
        return sendError(
          response,
          401,
          "INVALID_TOTP",
          "Der Zwei-Faktor-Code ist ungültig.",
        );
      }
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const deviceId = randomUUID();

      await client.query(
        `
          INSERT INTO devices (
            id,
            user_id,
            device_name,
            device_type,
            platform,
            last_seen_at
          )
          VALUES ($1, $2, $3, 'browser', 'web', now())
        `,
        [deviceId, databaseUser.id, deviceName],
      );

      const sessionId = randomUUID();
      const tokenFamilyId = randomUUID();
      const refreshToken = createRefreshToken();
      const refreshExpiresAt = getRefreshExpiration();

      await client.query(
        `
          INSERT INTO refresh_sessions (
            id,
            user_id,
            device_id,
            token_hash,
            token_family_id,
            expires_at,
            created_ip,
            user_agent
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          sessionId,
          databaseUser.id,
          deviceId,
          hashToken(refreshToken),
          tokenFamilyId,
          refreshExpiresAt,
          request.ip || null,
          request.get("user-agent") || null,
        ],
      );

      await client.query(
        `
          UPDATE users
          SET
            last_login_at = now(),
            updated_at = now()
          WHERE id = $1
        `,
        [databaseUser.id],
      );

      const updatedUserResult = await client.query(
        `
          SELECT ${USER_PUBLIC_COLUMNS}
          FROM users u
          WHERE u.id = $1
        `,
        [databaseUser.id],
      );

      await client.query("COMMIT");

      const user = mapUser(updatedUserResult.rows[0]);
      const accessToken = createAccessToken(user, sessionId);

      return response.json({
        ...createTokenResponse(
          accessToken,
          refreshToken,
          refreshExpiresAt,
        ),
        user,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/refresh", async (request, response, next) => {
  const refreshToken = request.body?.refreshToken;

  if (!refreshToken) {
    return sendError(
      response,
      400,
      "REFRESH_TOKEN_REQUIRED",
      "Das Refresh-Token fehlt.",
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
        SELECT
          rs.id AS session_id,
          rs.device_id,
          rs.token_family_id,
          rs.expires_at AS session_expires_at,
          rs.revoked_at AS session_revoked_at,
          u.deleted_at AS user_deleted_at,
          ${USER_PUBLIC_COLUMNS}
        FROM refresh_sessions rs
        INNER JOIN users u ON u.id = rs.user_id
        WHERE rs.token_hash = $1
        FOR UPDATE OF rs
      `,
      [hashToken(refreshToken)],
    );

    const session = result.rows[0];

    if (!session) {
      await client.query("ROLLBACK");

      return sendError(
        response,
        401,
        "REFRESH_TOKEN_INVALID",
        "Die Sitzung ist ungültig.",
      );
    }

    if (session.session_revoked_at) {
      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE token_family_id = $1
        `,
        [session.token_family_id],
      );

      await client.query("COMMIT");

      return sendError(
        response,
        401,
        "TOKEN_REUSE_DETECTED",
        "Die Sitzung wurde aus Sicherheitsgründen beendet.",
      );
    }

    if (
      new Date(session.session_expires_at) <= new Date() ||
      session.status !== "active" ||
      session.user_deleted_at
    ) {
      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE id = $1
        `,
        [session.session_id],
      );

      await client.query("COMMIT");

      return sendError(
        response,
        401,
        "SESSION_EXPIRED",
        "Die Sitzung ist abgelaufen.",
      );
    }

    const newSessionId = randomUUID();
    const newRefreshToken = createRefreshToken();
    const newRefreshExpiresAt = getRefreshExpiration();

    await client.query(
      `
        INSERT INTO refresh_sessions (
          id,
          user_id,
          device_id,
          token_hash,
          token_family_id,
          expires_at,
          created_ip,
          user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        newSessionId,
        session.id,
        session.device_id,
        hashToken(newRefreshToken),
        session.token_family_id,
        newRefreshExpiresAt,
        request.ip || null,
        request.get("user-agent") || null,
      ],
    );

    await client.query(
      `
        UPDATE refresh_sessions
        SET
          revoked_at = now(),
          last_used_at = now(),
          replaced_by_session_id = $1
        WHERE id = $2
      `,
      [newSessionId, session.session_id],
    );

    if (session.device_id) {
      await client.query(
        `
          UPDATE devices
          SET last_seen_at = now()
          WHERE id = $1
        `,
        [session.device_id],
      );
    }

    await client.query("COMMIT");

    const user = mapUser(session);
    const accessToken = createAccessToken(user, newSessionId);

    return response.json(
      createTokenResponse(
        accessToken,
        newRefreshToken,
        newRefreshExpiresAt,
      ),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

authRoutes.post(
  "/logout",
  requireAuth,
  async (request, response, next) => {
    try {
      await pool.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE id = $1
        `,
        [request.auth.sessionId],
      );

      response.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);