import { randomUUID } from "node:crypto";

import { pool } from "../database/pool.js";
import { mapUser } from "../lib/mappers.js";
import {
  createAccessToken,
  createRefreshToken,
  getAccessTokenExpiration,
  getAccessTokenLifetimeSeconds,
  getRefreshExpiration,
  hashToken,
} from "../security/tokens.js";

function requestIp(request) {
  return request.ip || request.socket?.remoteAddress || null;
}

export async function createOrReuseDevice(
  client,
  userId,
  {
    externalId = null,
    deviceName = "Unbekanntes Gerät",
    deviceType = "unknown",
    platform = null,
    appVersion = null,
  } = {},
) {
  if (externalId) {
    const result = await client.query(
      `
        INSERT INTO devices (
          user_id,
          external_id,
          device_name,
          device_type,
          platform,
          app_version,
          last_seen_at,
          revoked_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, now(), NULL)
        ON CONFLICT (user_id, external_id)
        WHERE external_id IS NOT NULL
        DO UPDATE SET
          device_name = EXCLUDED.device_name,
          device_type = EXCLUDED.device_type,
          platform = EXCLUDED.platform,
          app_version = EXCLUDED.app_version,
          last_seen_at = now(),
          revoked_at = NULL
        RETURNING *
      `,
      [
        userId,
        externalId,
        deviceName,
        deviceType,
        platform,
        appVersion,
      ],
    );

    return result.rows[0];
  }

  const result = await client.query(
    `
      INSERT INTO devices (
        user_id,
        device_name,
        device_type,
        platform,
        app_version,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, now())
      RETURNING *
    `,
    [userId, deviceName, deviceType, platform, appVersion],
  );

  return result.rows[0];
}

export async function issueTokenPair(
  client,
  user,
  request,
  {
    deviceId = null,
    tokenFamilyId = randomUUID(),
  } = {},
) {
  const refreshToken = createRefreshToken();
  const refreshExpiration = getRefreshExpiration();

  const sessionResult = await client.query(
    `
      INSERT INTO refresh_sessions (
        user_id,
        device_id,
        token_hash,
        token_family_id,
        expires_at,
        created_ip,
        user_agent,
        last_used_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      RETURNING id
    `,
    [
      user.id,
      deviceId,
      hashToken(refreshToken),
      tokenFamilyId,
      refreshExpiration,
      requestIp(request),
      request.get("user-agent") || null,
    ],
  );

  const sessionId = sessionResult.rows[0].id;
  const accessToken = createAccessToken(user, sessionId);
  const accessTokenExpiresAt = getAccessTokenExpiration(accessToken);

  return {
    accessToken,
    refreshToken,
    expiresIn: getAccessTokenLifetimeSeconds(),
    tokenType: "Bearer",
    accessTokenExpiresAt,
    refreshTokenExpiresAt: refreshExpiration,
    sessionId,
  };
}

export async function issueAuthResponse(
  client,
  userRow,
  request,
  options = {},
) {
  const tokens = await issueTokenPair(client, userRow, request, options);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    tokenType: tokens.tokenType,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    user: mapUser(userRow),
  };
}

export async function rotateRefreshToken(refreshToken, request) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
        SELECT
          rs.*,
          u.id AS auth_user_id,
          u.email,
          u.username,
          u.display_name,
          u.role,
          u.status AS user_status,
          u.locale,
          u.timezone,
          u.theme_mode,
          u.totp_enabled,
          u.force_password_change,
          u.last_login_at,
          u.created_at AS user_created_at,
          u.updated_at AS user_updated_at
        FROM refresh_sessions rs
        INNER JOIN users u ON u.id = rs.user_id
        WHERE rs.token_hash = $1
        LIMIT 1
        FOR UPDATE
      `,
      [hashToken(refreshToken)],
    );

    const session = result.rows[0];

    if (!session) {
      await client.query("ROLLBACK");
      return null;
    }

    if (session.revoked_at) {
      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE token_family_id = $1
        `,
        [session.token_family_id],
      );
      await client.query("COMMIT");
      return null;
    }

    if (
      new Date(session.expires_at).getTime() <= Date.now() ||
      session.user_status !== "active"
    ) {
      await client.query(
        `UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1`,
        [session.id],
      );
      await client.query("COMMIT");
      return null;
    }

    const user = {
      id: session.auth_user_id,
      email: session.email,
      username: session.username,
      display_name: session.display_name,
      role: session.role,
      status: session.user_status,
      locale: session.locale,
      timezone: session.timezone,
      theme_mode: session.theme_mode,
      totp_enabled: session.totp_enabled,
      force_password_change: session.force_password_change,
      last_login_at: session.last_login_at,
      created_at: session.user_created_at,
      updated_at: session.user_updated_at,
    };

    const tokens = await issueTokenPair(client, user, request, {
      deviceId: session.device_id,
      tokenFamilyId: session.token_family_id,
    });

    await client.query(
      `
        UPDATE refresh_sessions
        SET
          revoked_at = now(),
          replaced_by_session_id = $2,
          last_used_at = now()
        WHERE id = $1
      `,
      [session.id, tokens.sessionId],
    );

    if (session.device_id) {
      await client.query(
        `UPDATE devices SET last_seen_at = now() WHERE id = $1`,
        [session.device_id],
      );
    }

    await client.query("COMMIT");

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
