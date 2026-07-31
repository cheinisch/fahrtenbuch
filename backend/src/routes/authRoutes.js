import { randomUUID } from "node:crypto";
import { Router } from "express";
import QRCode from "qrcode";

import { config } from "../config.js";
import { pool } from "../database/pool.js";
import {
  badRequest,
  conflict,
  notFound,
  unauthorized,
} from "../lib/errors.js";
import { mapUser } from "../lib/mappers.js";
import {
  emailField,
  objectBody,
  stringField,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { decryptSecret, encryptSecret } from "../security/encryption.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import {
  createOpaqueToken,
  hashToken,
} from "../security/tokens.js";
import {
  createTotpQrCodeDataUrl,
  createTotpSecret,
  createTotpUri,
  verifyTotpCode,
} from "../security/totp.js";
import {
  createAuthenticationOptions,
  createRegistrationOptions,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "../security/webauthn.js";
import {
  createOrReuseDevice,
  issueAuthResponse,
  issueTokenPair,
  rotateRefreshToken,
} from "../services/sessionService.js";
import { USER_PUBLIC_COLUMNS } from "../users/userMapper.js";

export const authRoutes = Router();

async function deliverPasswordReset(email, token, expiresAt) {
  if (!config.passwordReset.webhookUrl) {
    return;
  }

  const resetUrl = new URL(config.passwordReset.publicUrl);
  resetUrl.searchParams.set("token", token);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(config.passwordReset.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        token,
        resetUrl: resetUrl.toString(),
        expiresAt,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Reset-Webhook antwortete mit HTTP ${response.status}.`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function loadActiveChallenges(type, userId) {
  const parameters = [type];
  let userCondition = "";

  if (userId === null) {
    userCondition = "AND user_id IS NULL";
  } else if (userId !== undefined) {
    parameters.push(userId);
    userCondition = `AND user_id = $${parameters.length}`;
  }

  const result = await pool.query(
    `
      SELECT id, challenge_hash
      FROM webauthn_challenges
      WHERE challenge_type = $1
        ${userCondition}
        AND used_at IS NULL
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 20
    `,
    parameters,
  );

  return result.rows;
}

function tokenPairOnly(authResponse) {
  return {
    accessToken: authResponse.accessToken,
    refreshToken: authResponse.refreshToken,
    expiresIn: authResponse.expiresIn,
    tokenType: authResponse.tokenType,
    accessTokenExpiresAt: authResponse.accessTokenExpiresAt,
    refreshTokenExpiresAt: authResponse.refreshTokenExpiresAt,
  };
}

authRoutes.post(
  "/login",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const identifier =
      stringField(body, "identifier", {
        maximum: 320,
      }) ||
      stringField(body, "email", {
        maximum: 320,
      });

    if (!identifier) {
      throw badRequest(
        "VALIDATION_ERROR",
        "Das Feld „identifier“ ist erforderlich.",
      );
    }

    const password = stringField(body, "password", {
      required: true,
      minimum: 1,
      maximum: 1024,
      trim: false,
    });
    const totpCode = stringField(body, "totpCode", {
      nullable: true,
      maximum: 6,
    });
    const deviceName =
      stringField(body, "deviceName", {
        nullable: true,
        maximum: 120,
      }) || "Webbrowser";

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          SELECT ${USER_PUBLIC_COLUMNS}, u.password_hash, u.totp_secret_encrypted
          FROM users u
          WHERE (
              lower(u.email) = lower($1)
              OR lower(u.username) = lower($1)
            )
            AND u.deleted_at IS NULL
          LIMIT 1
          FOR UPDATE
        `,
        [identifier],
      );

      const user = result.rows[0];

      if (
        !user ||
        user.status !== "active" ||
        !user.password_hash ||
        !(await verifyPassword(password, user.password_hash))
      ) {
        throw unauthorized(
          "INVALID_CREDENTIALS",
          "Anmeldename oder Passwort ist nicht korrekt.",
        );
      }

      if (user.totp_enabled) {
        if (!totpCode) {
          throw unauthorized(
            "MFA_REQUIRED",
            "Bitte gib den Zwei-Faktor-Code ein.",
          );
        }

        if (!/^\d{6}$/.test(totpCode)) {
          throw unauthorized(
            "INVALID_MFA_CODE",
            "Der Zwei-Faktor-Code ist ungültig.",
          );
        }

        const secret = decryptSecret(user.totp_secret_encrypted);

        if (!(await verifyTotpCode(secret, totpCode))) {
          throw unauthorized(
            "INVALID_MFA_CODE",
            "Der Zwei-Faktor-Code ist ungültig.",
          );
        }
      }

      const device = await createOrReuseDevice(client, user.id, {
        externalId:
          stringField(body, "deviceId", {
            nullable: true,
            maximum: 200,
          }) || null,
        deviceName,
        deviceType: "web",
        platform:
          stringField(body, "platform", {
            nullable: true,
            maximum: 64,
          }) || "web",
        appVersion: stringField(body, "appVersion", {
          nullable: true,
          maximum: 64,
        }),
      });

      const authResponse = await issueAuthResponse(client, user, request, {
        deviceId: device.id,
      });

      await client.query(
        `UPDATE users SET last_login_at = now() WHERE id = $1`,
        [user.id],
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
            user_agent
          )
          VALUES ($1, 'auth.login', 'user', $1, $2, $3, $4)
        `,
        [
          user.id,
          request.requestId,
          request.ip || null,
          request.get("user-agent") || null,
        ],
      );

      await client.query("COMMIT");
      response.json(authResponse);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

authRoutes.post(
  "/refresh",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const refreshToken = stringField(body, "refreshToken", {
      required: true,
      minimum: 20,
      maximum: 500,
    });

    const tokens = await rotateRefreshToken(refreshToken, request);

    if (!tokens) {
      throw unauthorized(
        "INVALID_REFRESH_TOKEN",
        "Das Refresh-Token ist ungültig oder abgelaufen.",
      );
    }

    response.json(tokens);
  }),
);

authRoutes.post(
  "/logout",
  requireAuth,
  asyncHandler(async (request, response) => {
    await pool.query(
      `UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1`,
      [request.auth.sessionId],
    );

    response.status(204).end();
  }),
);

authRoutes.post(
  "/logout-all",
  requireAuth,
  asyncHandler(async (request, response) => {
    await pool.query(
      `
        UPDATE refresh_sessions
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = $1
      `,
      [request.auth.userId],
    );

    response.status(204).end();
  }),
);

authRoutes.post(
  "/password/forgot",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const email = emailField(body, "email", true);

    const userResult = await pool.query(
      `
        SELECT id, email
        FROM users
        WHERE lower(email) = lower($1)
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    );

    const user = userResult.rows[0];
    let debugResetToken;

    if (user) {
      const token = createOpaqueToken(48);
      const expiresAt = new Date(
        Date.now() + config.passwordReset.expiresMinutes * 60_000,
      );

      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          `
            UPDATE password_reset_tokens
            SET used_at = COALESCE(used_at, now())
            WHERE user_id = $1 AND used_at IS NULL
          `,
          [user.id],
        );
        await client.query(
          `
            INSERT INTO password_reset_tokens (
              user_id,
              token_hash,
              expires_at
            )
            VALUES ($1, $2, $3)
          `,
          [user.id, hashToken(token), expiresAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      try {
        await deliverPasswordReset(user.email, token, expiresAt);
      } catch (error) {
        console.error("Passwort-Reset konnte nicht zugestellt werden:", error);
      }

      if (config.debug) {
        debugResetToken = token;
      }
    }

    response.status(202).json({
      accepted: true,
      ...(debugResetToken ? { debugResetToken } : {}),
    });
  }),
);

authRoutes.post(
  "/password/reset",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const token = stringField(body, "token", {
      required: true,
      minimum: 20,
      maximum: 500,
    });
    const password = stringField(body, "password", {
      required: true,
      minimum: 8,
      maximum: 1024,
      trim: false,
    });

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          SELECT prt.id, prt.user_id
          FROM password_reset_tokens prt
          INNER JOIN users u ON u.id = prt.user_id
          WHERE prt.token_hash = $1
            AND prt.used_at IS NULL
            AND prt.expires_at > now()
            AND u.status = 'active'
            AND u.deleted_at IS NULL
          LIMIT 1
          FOR UPDATE
        `,
        [hashToken(token)],
      );

      const reset = result.rows[0];

      if (!reset) {
        throw badRequest(
          "INVALID_RESET_TOKEN",
          "Der Passwort-Reset-Link ist ungültig oder abgelaufen.",
        );
      }

      const passwordHash = await hashPassword(password);

      await client.query(
        `
          UPDATE users
          SET
            password_hash = $2,
            password_changed_at = now(),
            force_password_change = false
          WHERE id = $1
        `,
        [reset.user_id, passwordHash],
      );

      await client.query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`,
        [reset.id],
      );

      await client.query(
        `
          UPDATE refresh_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
        `,
        [reset.user_id],
      );

      await client.query("COMMIT");
      response.json({ changed: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

authRoutes.post(
  "/mfa/totp/setup",
  requireAuth,
  asyncHandler(async (request, response) => {
    const userResult = await pool.query(
      `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [request.auth.userId],
    );

    if (userResult.rowCount === 0) {
      throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
    }

    const secret = createTotpSecret();
    const otpauthUrl = createTotpUri(userResult.rows[0].email, secret);
    const qrCodeDataUrl = await createTotpQrCodeDataUrl(otpauthUrl);

    await pool.query(
      `
        UPDATE users
        SET
          totp_secret_encrypted = $2,
          totp_enabled = false
        WHERE id = $1
      `,
      [request.auth.userId, encryptSecret(secret)],
    );

    response.json({ secret, otpauthUrl, qrCodeDataUrl });
  }),
);

authRoutes.post(
  "/mfa/totp/verify",
  requireAuth,
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const code = stringField(body, "code", {
      required: true,
      minimum: 6,
      maximum: 6,
    });

    if (!/^\d{6}$/.test(code)) {
      throw badRequest(
        "INVALID_TOTP_CODE",
        "Der TOTP-Code muss aus sechs Ziffern bestehen.",
      );
    }

    const result = await pool.query(
      `
        SELECT totp_secret_encrypted
        FROM users
        WHERE id = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [request.auth.userId],
    );

    const encrypted = result.rows[0]?.totp_secret_encrypted;

    if (!encrypted) {
      throw badRequest(
        "TOTP_SETUP_REQUIRED",
        "Starte zuerst die TOTP-Einrichtung.",
      );
    }

    if (!(await verifyTotpCode(decryptSecret(encrypted), code))) {
      throw badRequest("INVALID_TOTP_CODE", "Der TOTP-Code ist ungültig.");
    }

    await pool.query(
      `UPDATE users SET totp_enabled = true WHERE id = $1`,
      [request.auth.userId],
    );

    response.json({ enabled: true });
  }),
);

authRoutes.delete(
  "/mfa/totp",
  requireAuth,
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
        UPDATE users
        SET
          totp_enabled = false,
          totp_secret_encrypted = NULL
        WHERE id = $1
          AND deleted_at IS NULL
          AND totp_required = false
        RETURNING id
      `,
      [request.auth.userId],
    );

    if (result.rowCount === 0) {
      const userResult = await pool.query(
        `
          SELECT totp_required
          FROM users
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [request.auth.userId],
      );

      if (userResult.rowCount === 0) {
        throw notFound(
          "USER_NOT_FOUND",
          "Der Benutzer wurde nicht gefunden.",
        );
      }

      throw badRequest(
        "TOTP_REQUIRED_BY_ADMIN",
        "TOTP wird für dieses Konto durch die Administration verlangt.",
      );
    }

    response.status(204).end();
  }),
);

authRoutes.post(
  "/passkeys/register/options",
  requireAuth,
  asyncHandler(async (request, response) => {
    const [userResult, passkeysResult] = await Promise.all([
      pool.query(
        `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [request.auth.userId],
      ),
      pool.query(
        `SELECT credential_id, transports FROM passkeys WHERE user_id = $1`,
        [request.auth.userId],
      ),
    ]);

    const user = userResult.rows[0];

    if (!user) {
      throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
    }

    if (!user.passkey_enabled) {
      throw badRequest(
        "PASSKEY_DISABLED_BY_ADMIN",
        "Passkeys sind für dieses Benutzerkonto deaktiviert.",
      );
    }

    const options = await createRegistrationOptions(user, passkeysResult.rows);

    await pool.query(
      `
        INSERT INTO webauthn_challenges (
          user_id,
          challenge_type,
          challenge_hash,
          expires_at,
          metadata
        )
        VALUES ($1, 'register', $2, now() + interval '5 minutes', $3::jsonb)
      `,
      [
        user.id,
        hashToken(options.challenge),
        JSON.stringify({ webauthnUserId: options.user.id }),
      ],
    );

    response.json(options);
  }),
);

authRoutes.post(
  "/passkeys/register/verify",
  requireAuth,
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const userResult = await pool.query(
      `
        SELECT passkey_enabled
        FROM users
        WHERE id = $1
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [request.auth.userId],
    );

    if (!userResult.rows[0]?.passkey_enabled) {
      throw badRequest(
        "PASSKEY_DISABLED_BY_ADMIN",
        "Passkeys sind für dieses Benutzerkonto deaktiviert.",
      );
    }

    const challenges = await loadActiveChallenges(
      "register",
      request.auth.userId,
    );
    let matchedChallengeId = null;

    const verification = await verifyPasskeyRegistration(
      body,
      async (challengeHash) => {
        const match = challenges.find(
          (challenge) => challenge.challenge_hash === challengeHash,
        );
        matchedChallengeId = match?.id || null;
        return Boolean(match);
      },
    );

    if (
      !verification.verified ||
      !verification.registrationInfo ||
      !matchedChallengeId
    ) {
      throw badRequest(
        "PASSKEY_VERIFICATION_FAILED",
        "Der Passkey konnte nicht verifiziert werden.",
      );
    }

    const {
      credential,
      credentialDeviceType,
      credentialBackedUp,
    } = verification.registrationInfo;

    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : "Passkey";

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE webauthn_challenges SET used_at = now() WHERE id = $1`,
        [matchedChallengeId],
      );
      await client.query(
        `
          INSERT INTO passkeys (
            user_id,
            credential_id,
            public_key,
            counter,
            transports,
            name,
            backed_up,
            device_type
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          request.auth.userId,
          credential.id,
          Buffer.from(credential.publicKey),
          credential.counter,
          body.response?.transports || credential.transports || [],
          name,
          credentialBackedUp,
          credentialDeviceType,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    response.json({ verified: true });
  }),
);

authRoutes.post(
  "/passkeys/login/options",
  asyncHandler(async (_request, response) => {
    const options = await createAuthenticationOptions();

    await pool.query(
      `
        INSERT INTO webauthn_challenges (
          user_id,
          challenge_type,
          challenge_hash,
          expires_at
        )
        VALUES (NULL, 'login', $1, now() + interval '5 minutes')
      `,
      [hashToken(options.challenge)],
    );

    response.json(options);
  }),
);

authRoutes.post(
  "/passkeys/login/verify",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const credentialId = stringField(body, "id", {
      required: true,
      maximum: 2048,
    });

    const result = await pool.query(
      `
        SELECT
          p.id AS passkey_id,
          p.user_id,
          p.credential_id,
          p.public_key,
          p.counter,
          p.transports,
          u.id,
          u.email,
          u.username,
          u.display_name,
          u.first_name,
          u.last_name,
          u.role,
          u.status,
          u.locale,
          u.timezone,
          u.theme_mode,
          u.totp_enabled,
          u.totp_required,
          u.passkey_enabled,
          (u.password_hash IS NOT NULL) AS has_password,
          u.force_password_change,
          u.last_login_at,
          u.created_at,
          u.updated_at
        FROM passkeys p
        INNER JOIN users u ON u.id = p.user_id
        WHERE p.credential_id = $1
          AND u.status = 'active'
          AND u.passkey_enabled = true
          AND u.deleted_at IS NULL
        LIMIT 1
      `,
      [credentialId],
    );

    const passkey = result.rows[0];

    if (!passkey) {
      throw unauthorized(
        "PASSKEY_NOT_FOUND",
        "Der Passkey ist nicht registriert.",
      );
    }

    const challenges = await loadActiveChallenges("login", null);
    let matchedChallengeId = null;

    const verification = await verifyPasskeyAuthentication(
      body,
      passkey,
      async (challengeHash) => {
        const match = challenges.find(
          (challenge) => challenge.challenge_hash === challengeHash,
        );
        matchedChallengeId = match?.id || null;
        return Boolean(match);
      },
    );

    if (!verification.verified || !matchedChallengeId) {
      throw unauthorized(
        "PASSKEY_VERIFICATION_FAILED",
        "Der Passkey konnte nicht verifiziert werden.",
      );
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE webauthn_challenges SET used_at = now() WHERE id = $1`,
        [matchedChallengeId],
      );
      await client.query(
        `
          UPDATE passkeys
          SET counter = $2, last_used_at = now()
          WHERE id = $1
        `,
        [passkey.passkey_id, verification.authenticationInfo.newCounter],
      );

      const device = await createOrReuseDevice(client, passkey.user_id, {
        externalId:
          stringField(body, "deviceId", {
            nullable: true,
            maximum: 200,
          }) || null,
        deviceName:
          stringField(body, "deviceName", {
            nullable: true,
            maximum: 120,
          }) || "Passkey-Gerät",
        deviceType: "web",
        platform:
          stringField(body, "platform", {
            nullable: true,
            maximum: 64,
          }) || "web",
        appVersion: stringField(body, "appVersion", {
          nullable: true,
          maximum: 64,
        }),
      });

      const authResponse = await issueAuthResponse(client, passkey, request, {
        deviceId: device.id,
      });

      await client.query(
        `UPDATE users SET last_login_at = now() WHERE id = $1`,
        [passkey.user_id],
      );

      await client.query("COMMIT");
      response.json(authResponse);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

authRoutes.get(
  "/passkeys",
  requireAuth,
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
        SELECT id, name, transports, backed_up, device_type, last_used_at, created_at
        FROM passkeys
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [request.auth.userId],
    );

    response.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        transports: row.transports,
        backedUp: row.backed_up,
        deviceType: row.device_type,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
      })),
    );
  }),
);

authRoutes.delete(
  "/passkeys/:id",
  requireAuth,
  asyncHandler(async (request, response) => {
    const id = uuidValue(request.params.id);
    const result = await pool.query(
      `DELETE FROM passkeys WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, request.auth.userId],
    );

    if (result.rowCount === 0) {
      throw notFound("PASSKEY_NOT_FOUND", "Der Passkey wurde nicht gefunden.");
    }

    response.status(204).end();
  }),
);

authRoutes.post(
  "/pair/options",
  requireAuth,
  asyncHandler(async (request, response) => {
    const settingsResult = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'pairing.expiresSeconds'`,
    );
    const expiresSeconds = Math.max(
      30,
      Math.min(900, Number(settingsResult.rows[0]?.value || 120)),
    );
    const pairId = randomUUID();
    const pairToken = createOpaqueToken(48);
    const expiresAt = new Date(Date.now() + expiresSeconds * 1000);

    await pool.query(
      `
        INSERT INTO pairing_requests (
          id,
          user_id,
          token_hash,
          expires_at
        )
        VALUES ($1, $2, $3, $4)
      `,
      [pairId, request.auth.userId, hashToken(pairToken), expiresAt],
    );

    const payloadObject = {
      version: 1,
      type: "pair",
      server: config.publicBaseUrl,
      pairId,
      pairToken,
      username: request.auth.user.loginName || request.auth.user.username,
      email: request.auth.user.email,
      expiresAt: expiresAt.toISOString(),
    };
    const payload = JSON.stringify(payloadObject);
    const qrCodeDataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 360,
    });

    response.json({
      pairId,
      payload,
      payloadObject,
      qrCodeDataUrl,
      expiresAt,
    });
  }),
);

authRoutes.post(
  "/pair",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const pairId = uuidValue(
      stringField(body, "pairId", { required: true, maximum: 64 }),
      "pairId",
    );
    const pairToken = stringField(body, "pairToken", {
      required: true,
      minimum: 20,
      maximum: 500,
    });
    const externalDeviceId = stringField(body, "deviceId", {
      required: true,
      minimum: 1,
      maximum: 200,
    });
    const deviceName = stringField(body, "deviceName", {
      required: true,
      minimum: 1,
      maximum: 120,
    });
    const platform = stringField(body, "platform", {
      required: true,
      minimum: 1,
      maximum: 64,
    });
    const appVersion = stringField(body, "appVersion", {
      nullable: true,
      maximum: 64,
    });

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          SELECT
            pr.id AS pairing_id,
            pr.user_id,
            pr.token_hash,
            pr.status AS pairing_status,
            pr.expires_at,
            u.id,
            u.email,
            u.username,
            u.display_name,
            u.first_name,
            u.last_name,
            u.role,
            u.status,
            u.locale,
            u.timezone,
            u.theme_mode,
            u.totp_enabled,
            u.totp_required,
            u.passkey_enabled,
            (u.password_hash IS NOT NULL) AS has_password,
            u.force_password_change,
            u.last_login_at,
            u.created_at,
            u.updated_at
          FROM pairing_requests pr
          INNER JOIN users u ON u.id = pr.user_id
          WHERE pr.id = $1
          LIMIT 1
          FOR UPDATE OF pr
        `,
        [pairId],
      );

      const row = result.rows[0];

      if (!row || row.token_hash !== hashToken(pairToken)) {
        throw unauthorized(
          "INVALID_PAIR_TOKEN",
          "Das Pairing-Token ist ungültig.",
        );
      }

      if (row.pairing_status !== "pending") {
        throw conflict(
          "PAIRING_NOT_PENDING",
          "Das Pairing ist nicht mehr offen.",
        );
      }

      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE pairing_requests SET status = 'expired' WHERE id = $1`,
          [pairId],
        );
        throw unauthorized("PAIRING_EXPIRED", "Der QR-Code ist abgelaufen.");
      }

      if (row.status !== "active") {
        throw unauthorized("USER_DISABLED", "Das Benutzerkonto ist deaktiviert.");
      }

      const device = await createOrReuseDevice(client, row.user_id, {
        externalId: externalDeviceId,
        deviceName,
        deviceType: "mobile",
        platform,
        appVersion,
      });

      const tokens = await issueTokenPair(client, row, request, {
        deviceId: device.id,
      });

      await client.query(
        `
          UPDATE pairing_requests
          SET
            status = 'completed',
            completed_device_id = $2,
            completed_at = now()
          WHERE id = $1
        `,
        [pairId, device.id],
      );

      await client.query("COMMIT");
      response.json(tokenPairOnly(tokens));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

authRoutes.get(
  "/pair/:pairId/status",
  requireAuth,
  asyncHandler(async (request, response) => {
    const pairId = uuidValue(request.params.pairId, "pairId");

    const result = await pool.query(
      `
        SELECT status, expires_at, completed_at
        FROM pairing_requests
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [pairId, request.auth.userId],
    );

    const pairing = result.rows[0];

    if (!pairing) {
      throw notFound("PAIRING_NOT_FOUND", "Das Pairing wurde nicht gefunden.");
    }

    let status = pairing.status;

    if (
      status === "pending" &&
      new Date(pairing.expires_at).getTime() <= Date.now()
    ) {
      status = "expired";
      await pool.query(
        `UPDATE pairing_requests SET status = 'expired' WHERE id = $1`,
        [pairId],
      );
    }

    response.json({
      status,
      tokens: null,
      expiresAt: pairing.expires_at,
      completedAt: pairing.completed_at,
    });
  }),
);

authRoutes.delete(
  "/pair/:pairId",
  requireAuth,
  asyncHandler(async (request, response) => {
    const pairId = uuidValue(request.params.pairId, "pairId");

    const result = await pool.query(
      `
        UPDATE pairing_requests
        SET status = 'cancelled', cancelled_at = now()
        WHERE id = $1
          AND user_id = $2
          AND status = 'pending'
        RETURNING id
      `,
      [pairId, request.auth.userId],
    );

    if (result.rowCount === 0) {
      throw notFound(
        "PAIRING_NOT_FOUND",
        "Ein offenes Pairing wurde nicht gefunden.",
      );
    }

    response.status(204).end();
  }),
);
