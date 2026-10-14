import { Router } from "express";

import { config } from "../config.js";
import { pool } from "../database/pool.js";
import {
  conflict,
  notFound,
  unauthorized,
} from "../lib/errors.js";
import {
  objectBody,
  stringField,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { decryptSecret, encryptSecret } from "../security/encryption.js";
import {
  OAuthError,
  buildAuthorizationUrl,
  exchangeCode,
  getProvider,
  listProviders,
  randomToken,
} from "../security/oauth.js";
import { hashToken } from "../security/tokens.js";
import { verifyTotpCode } from "../security/totp.js";
import {
  createOrReuseDevice,
  issueAuthResponse,
} from "../services/sessionService.js";
import { USER_PUBLIC_COLUMNS } from "../users/userMapper.js";

export const oauthRoutes = Router();

const STATE_LIFETIME_MINUTES = 10;
const TICKET_LIFETIME_MINUTES = 5;
const BINDING_COOKIE = "fb_oauth";
const COOKIE_PATH = "/api/v1/auth/oauth";

function readCookie(request, name) {
  const header = request.get("cookie") || "";

  for (const part of header.split(";")) {
    const index = part.indexOf("=");

    if (index > 0 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return null;
}

function cookieAttributes(maxAgeSeconds) {
  return [
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
    // Lax: der Cookie muss beim Top-Level-Redirect vom Anbieter mitkommen
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(config.publicBaseUrl.startsWith("https://") ? ["Secure"] : []),
  ].join("; ");
}

function setBindingCookie(response, value) {
  response.append(
    "Set-Cookie",
    `${BINDING_COOKIE}=${encodeURIComponent(value)}; ${cookieAttributes(STATE_LIFETIME_MINUTES * 60)}`,
  );
}

function clearBindingCookie(response) {
  response.append("Set-Cookie", `${BINDING_COOKIE}=; ${cookieAttributes(0)}`);
}

function requireProvider(providerId) {
  const provider = getProvider(providerId);

  if (!provider) {
    throw notFound(
      "OAUTH_PROVIDER_DISABLED",
      "Dieser Anmeldeanbieter ist auf diesem Server nicht eingerichtet.",
    );
  }

  return provider;
}

function frontendUrl(pathname, { query = {}, hash = "" } = {}) {
  const url = new URL(pathname, `${config.publicBaseUrl}/`);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const hashParameters =
    typeof hash === "string" ? hash : new URLSearchParams(hash).toString();

  if (hashParameters) {
    url.hash = hashParameters;
  }

  return url.toString();
}

function mapIdentity(row) {
  return {
    id: row.id,
    provider: row.provider,
    email: row.email,
    displayName: row.display_name,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

async function startAuthorization(request, response, provider, purpose, userId) {
  const state = randomToken();
  const codeVerifier = randomToken(48);
  const nonce = randomToken();
  const browserBinding = randomToken();

  // Alte Einträge nebenbei aufräumen
  await pool.query(
    `DELETE FROM oauth_states WHERE expires_at < now() - interval '1 day'`,
  );
  await pool.query(
    `DELETE FROM oauth_login_tickets WHERE expires_at < now() - interval '1 day'`,
  );

  await pool.query(
    `
      INSERT INTO oauth_states (
        state_hash,
        browser_binding_hash,
        provider,
        purpose,
        user_id,
        code_verifier_encrypted,
        nonce_encrypted,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8))
    `,
    [
      hashToken(state),
      hashToken(browserBinding),
      provider.id,
      purpose,
      userId,
      encryptSecret(codeVerifier),
      encryptSecret(nonce),
      STATE_LIFETIME_MINUTES,
    ],
  );

  setBindingCookie(response, browserBinding);
  response.json({
    authorizationUrl: buildAuthorizationUrl(provider, {
      state,
      codeVerifier,
      nonce,
    }),
  });
}

oauthRoutes.get(
  "/providers",
  asyncHandler(async (_request, response) => {
    response.json(listProviders());
  }),
);

oauthRoutes.post(
  "/:provider/login",
  asyncHandler(async (request, response) => {
    const provider = requireProvider(request.params.provider);
    await startAuthorization(request, response, provider, "login", null);
  }),
);

oauthRoutes.post(
  "/:provider/link",
  requireAuth,
  asyncHandler(async (request, response) => {
    const provider = requireProvider(request.params.provider);
    await startAuthorization(
      request,
      response,
      provider,
      "link",
      request.auth.userId,
    );
  }),
);

async function handleLoginCallback(provider, identity) {
  const result = await pool.query(
    `
      SELECT i.id AS identity_id, u.id AS user_id
      FROM user_identities i
      INNER JOIN users u ON u.id = i.user_id
      WHERE i.provider = $1
        AND i.subject = $2
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [provider.id, identity.subject],
  );

  const row = result.rows[0];

  if (!row) {
    throw new OAuthError(
      "OAUTH_NOT_LINKED",
      "Dieses Konto ist mit keinem Benutzer verknüpft.",
    );
  }

  const ticket = randomToken(32);

  await pool.query(
    `
      UPDATE user_identities
      SET
        email = COALESCE($2, email),
        display_name = COALESCE($3, display_name)
      WHERE id = $1
    `,
    [row.identity_id, identity.email, identity.displayName],
  );

  await pool.query(
    `
      INSERT INTO oauth_login_tickets (ticket_hash, user_id, identity_id, expires_at)
      VALUES ($1, $2, $3, now() + make_interval(mins => $4))
    `,
    [hashToken(ticket), row.user_id, row.identity_id, TICKET_LIFETIME_MINUTES],
  );

  // Ticket im Fragment: landet nicht in Server- oder Proxy-Logs
  return frontendUrl("/login", { hash: { oauthTicket: ticket } });
}

async function handleLinkCallback(provider, identity, userId, request) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
        SELECT id
        FROM users
        WHERE id = $1 AND status = 'active' AND deleted_at IS NULL
        FOR UPDATE
      `,
      [userId],
    );

    if (userResult.rowCount === 0) {
      throw new OAuthError("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
    }

    const existing = await client.query(
      `
        SELECT id, user_id, provider, subject
        FROM user_identities
        WHERE (provider = $1 AND subject = $2)
           OR (user_id = $3 AND provider = $1)
      `,
      [provider.id, identity.subject, userId],
    );

    const sameIdentity = existing.rows.find(
      (row) => row.subject === identity.subject,
    );

    if (sameIdentity && sameIdentity.user_id !== userId) {
      throw new OAuthError(
        "OAUTH_IDENTITY_IN_USE",
        "Dieses Konto ist bereits mit einem anderen Benutzer verknüpft.",
      );
    }

    if (!sameIdentity && existing.rowCount > 0) {
      throw new OAuthError(
        "OAUTH_PROVIDER_ALREADY_LINKED",
        "Für diesen Anbieter ist bereits ein Konto verknüpft.",
      );
    }

    if (sameIdentity) {
      await client.query(
        `
          UPDATE user_identities
          SET email = COALESCE($2, email), display_name = COALESCE($3, display_name)
          WHERE id = $1
        `,
        [sameIdentity.id, identity.email, identity.displayName],
      );
    } else {
      const inserted = await client.query(
        `
          INSERT INTO user_identities (user_id, provider, subject, email, display_name)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `,
        [userId, provider.id, identity.subject, identity.email, identity.displayName],
      );

      await client.query(
        `
          INSERT INTO audit_log (
            actor_user_id, action, entity_type, entity_id,
            request_id, ip_address, user_agent, metadata
          )
          VALUES ($1, 'auth.oauth.link', 'user_identity', $2, $3, $4, $5, $6::jsonb)
        `,
        [
          userId,
          inserted.rows[0].id,
          request.requestId,
          request.ip || null,
          request.get("user-agent") || null,
          JSON.stringify({ provider: provider.id }),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return frontendUrl("/profilesettings", {
    query: { oauthLinked: provider.id },
    hash: "section-security",
  });
}

oauthRoutes.get(
  "/:provider/callback",
  asyncHandler(async (request, response) => {
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const providerError =
      typeof request.query.error === "string" ? request.query.error : "";
    const browserBinding = readCookie(request, BINDING_COOKIE);

    clearBindingCookie(response);

    // State sofort verbrauchen: jeder Callback zählt genau einmal
    const stateResult = state
      ? await pool.query(
          `
            UPDATE oauth_states
            SET used_at = now()
            WHERE state_hash = $1
              AND provider = $2
              AND used_at IS NULL
              AND expires_at > now()
            RETURNING purpose, user_id, browser_binding_hash,
                      code_verifier_encrypted, nonce_encrypted
          `,
          [hashToken(state), request.params.provider],
        )
      : { rows: [] };

    const pending = stateResult.rows[0];
    const errorTarget = pending?.purpose === "link" ? "/profilesettings" : "/login";
    const redirectWithError = (errorCode) =>
      response.redirect(
        303,
        frontendUrl(errorTarget, {
          query: { oauthError: errorCode },
          ...(errorTarget === "/profilesettings"
            ? { hash: "section-security" }
            : {}),
        }),
      );

    if (
      !pending ||
      !browserBinding ||
      hashToken(browserBinding) !== pending.browser_binding_hash
    ) {
      return redirectWithError("OAUTH_STATE_INVALID");
    }

    if (providerError) {
      return redirectWithError(
        providerError === "access_denied" ? "OAUTH_CANCELLED" : "OAUTH_PROVIDER_ERROR",
      );
    }

    const provider = getProvider(request.params.provider);

    if (!provider || !code) {
      return redirectWithError("OAUTH_PROVIDER_ERROR");
    }

    try {
      const identity = await exchangeCode(provider, {
        code,
        codeVerifier: decryptSecret(pending.code_verifier_encrypted),
        nonce: decryptSecret(pending.nonce_encrypted),
      });

      const target =
        pending.purpose === "link"
          ? await handleLinkCallback(provider, identity, pending.user_id, request)
          : await handleLoginCallback(provider, identity);

      return response.redirect(303, target);
    } catch (error) {
      if (error instanceof OAuthError) {
        return redirectWithError(error.code);
      }

      console.error("OAuth-Callback fehlgeschlagen:", error);
      return redirectWithError("OAUTH_PROVIDER_ERROR");
    }
  }),
);

oauthRoutes.post(
  "/exchange",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const ticket = stringField(body, "ticket", {
      required: true,
      minimum: 20,
      maximum: 200,
    });
    const totpCode = stringField(body, "totpCode", {
      nullable: true,
      maximum: 6,
    });

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          SELECT
            ${USER_PUBLIC_COLUMNS},
            u.totp_secret_encrypted,
            t.id AS ticket_id,
            i.id AS identity_id,
            i.provider
          FROM oauth_login_tickets t
          INNER JOIN user_identities i ON i.id = t.identity_id
          INNER JOIN users u ON u.id = t.user_id
          WHERE t.ticket_hash = $1
            AND t.used_at IS NULL
            AND t.expires_at > now()
            AND u.status = 'active'
            AND u.deleted_at IS NULL
          LIMIT 1
          FOR UPDATE OF t
        `,
        [hashToken(ticket)],
      );

      const user = result.rows[0];

      if (!user) {
        throw unauthorized(
          "OAUTH_TICKET_INVALID",
          "Die Anmeldung ist abgelaufen. Bitte versuche es erneut.",
        );
      }

      // Das Ticket bleibt bis zur erfolgreichen Prüfung gültig, damit der
      // Code nach MFA_REQUIRED nachgereicht werden kann.
      if (user.totp_enabled) {
        if (!totpCode) {
          throw unauthorized("MFA_REQUIRED", "Bitte gib den Zwei-Faktor-Code ein.");
        }

        if (
          !/^\d{6}$/.test(totpCode) ||
          !(await verifyTotpCode(decryptSecret(user.totp_secret_encrypted), totpCode))
        ) {
          throw unauthorized("INVALID_MFA_CODE", "Der Zwei-Faktor-Code ist ungültig.");
        }
      }

      await client.query(
        `UPDATE oauth_login_tickets SET used_at = now() WHERE id = $1`,
        [user.ticket_id],
      );
      await client.query(
        `UPDATE user_identities SET last_used_at = now() WHERE id = $1`,
        [user.identity_id],
      );

      const device = await createOrReuseDevice(client, user.id, {
        externalId:
          stringField(body, "deviceId", { nullable: true, maximum: 200 }) || null,
        deviceName:
          stringField(body, "deviceName", { nullable: true, maximum: 120 }) ||
          "Webbrowser",
        deviceType: "web",
        platform:
          stringField(body, "platform", { nullable: true, maximum: 64 }) || "web",
        appVersion: stringField(body, "appVersion", { nullable: true, maximum: 64 }),
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
            actor_user_id, action, entity_type, entity_id,
            request_id, ip_address, user_agent, metadata
          )
          VALUES ($1, 'auth.login', 'user', $1, $2, $3, $4, $5::jsonb)
        `,
        [
          user.id,
          request.requestId,
          request.ip || null,
          request.get("user-agent") || null,
          JSON.stringify({ method: "oauth", provider: user.provider }),
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

oauthRoutes.get(
  "/identities",
  requireAuth,
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
        SELECT id, provider, email, display_name, last_used_at, created_at
        FROM user_identities
        WHERE user_id = $1
        ORDER BY created_at
      `,
      [request.auth.userId],
    );

    response.json(result.rows.map(mapIdentity));
  }),
);

oauthRoutes.delete(
  "/identities/:id",
  requireAuth,
  asyncHandler(async (request, response) => {
    const id = uuidValue(request.params.id);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          SELECT
            i.id,
            i.provider,
            (u.password_hash IS NOT NULL) AS has_password,
            (
              u.passkey_enabled
              AND EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)
            ) AS has_passkey,
            (
              SELECT count(*)::int
              FROM user_identities other
              WHERE other.user_id = u.id AND other.id <> i.id
            ) AS other_identities
          FROM user_identities i
          INNER JOIN users u ON u.id = i.user_id
          WHERE i.id = $1 AND i.user_id = $2
          FOR UPDATE OF u
        `,
        [id, request.auth.userId],
      );

      const identity = result.rows[0];

      if (!identity) {
        throw notFound(
          "OAUTH_IDENTITY_NOT_FOUND",
          "Das verknüpfte Konto wurde nicht gefunden.",
        );
      }

      // Ohne Passwort, Passkey oder weiteres Konto käme niemand mehr hinein
      if (
        !identity.has_password &&
        !identity.has_passkey &&
        identity.other_identities === 0
      ) {
        throw conflict(
          "LAST_LOGIN_METHOD",
          "Das ist deine letzte Anmeldemöglichkeit. Lege zuerst ein Passwort oder einen Passkey an.",
        );
      }

      await client.query(`DELETE FROM user_identities WHERE id = $1`, [id]);
      await client.query(
        `
          INSERT INTO audit_log (
            actor_user_id, action, entity_type, entity_id,
            request_id, ip_address, user_agent, metadata
          )
          VALUES ($1, 'auth.oauth.unlink', 'user_identity', $2, $3, $4, $5, $6::jsonb)
        `,
        [
          request.auth.userId,
          id,
          request.requestId,
          request.ip || null,
          request.get("user-agent") || null,
          JSON.stringify({ provider: identity.provider }),
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    response.status(204).end();
  }),
);
