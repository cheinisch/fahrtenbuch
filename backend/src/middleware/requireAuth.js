import { pool } from "../database/pool.js";
import { unauthorized } from "../lib/errors.js";
import { mapUser } from "../lib/mappers.js";
import { verifyAccessToken } from "../security/tokens.js";
import { asyncHandler } from "./asyncHandler.js";

export const requireAuth = asyncHandler(async (request, _response, next) => {
  const authorization = request.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);

  if (!match) {
    throw unauthorized("UNAUTHORIZED", "Ein Bearer-Token ist erforderlich.");
  }

  let payload;

  try {
    payload = verifyAccessToken(match[1]);
  } catch {
    throw unauthorized("INVALID_ACCESS_TOKEN", "Das Access-Token ist ungültig oder abgelaufen.");
  }

  const result = await pool.query(
    `
      SELECT
        rs.id AS session_id,
        rs.device_id,
        rs.revoked_at,
        rs.expires_at,
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
        u.updated_at
      FROM refresh_sessions rs
      INNER JOIN users u ON u.id = rs.user_id
      WHERE rs.id = $1
        AND u.id = $2
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [payload.sid, payload.sub],
  );

  const row = result.rows[0];

  if (
    !row ||
    row.revoked_at ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    row.status !== "active"
  ) {
    throw unauthorized("SESSION_INVALID", "Die Sitzung ist nicht mehr gültig.");
  }

  request.auth = {
    userId: row.id,
    sessionId: row.session_id,
    deviceId: row.device_id,
    role: row.role,
    user: mapUser(row),
  };

  pool
    .query(
      `
        UPDATE refresh_sessions
        SET last_used_at = now()
        WHERE id = $1;
      `,
      [row.session_id],
    )
    .catch(() => {});

  if (row.device_id) {
    pool
      .query(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [row.device_id])
      .catch(() => {});
  }

  next();
});
