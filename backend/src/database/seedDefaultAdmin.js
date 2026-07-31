import { pool } from "./pool.js";
import { hashPassword } from "../security/password.js";

function requiredEnvironment(name) {
  const value = process.env[name];

  if (!value) {
    return null;
  }

  return value.trim();
}

export async function seedDefaultAdmin() {
  const email = requiredEnvironment("DEFAULT_ADMIN_EMAIL");
  const username = requiredEnvironment("DEFAULT_ADMIN_USERNAME");
  const password = process.env.DEFAULT_ADMIN_PASSWORD;

  if (!email || !username || !password) {
    console.warn(
      "Default-Admin wurde übersprungen: DEFAULT_ADMIN_EMAIL, " +
        "DEFAULT_ADMIN_USERNAME und DEFAULT_ADMIN_PASSWORD sind nicht vollständig gesetzt.",
    );
    return;
  }

  const displayName =
    requiredEnvironment("DEFAULT_ADMIN_DISPLAYNAME") ||
    requiredEnvironment("DEFAULT_ADMIN_DISPLAY_NAME") ||
    username;

  const forcePasswordChange = !["false", "0", "no", "off"].includes(
    String(process.env.FORCE_ADMIN_PASSWORD_CHANGE ?? "true").toLowerCase(),
  );

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fahrtenbuch-default-admin'))");

    const existing = await client.query(
      `
        SELECT id
        FROM users
        WHERE deleted_at IS NULL
          AND (lower(email) = lower($1) OR lower(username) = lower($2))
        LIMIT 1
      `,
      [email, username],
    );

    if (existing.rowCount > 0) {
      await client.query("COMMIT");
      console.log("Default-Admin ist bereits vorhanden.");
      return;
    }

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
        VALUES ($1, $2, $3, $4, now(), 'admin', 'active', 'de', $5, 'system', $6)
        RETURNING id
      `,
      [
        email.toLowerCase(),
        username,
        displayName,
        passwordHash,
        process.env.TZ || "Europe/Berlin",
        forcePasswordChange,
      ],
    );

    await client.query(
      `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [result.rows[0].id],
    );

    await client.query(
      `
        INSERT INTO audit_log (
          actor_user_id,
          action,
          entity_type,
          entity_id,
          metadata
        )
        VALUES ($1, 'admin.seeded', 'user', $1, '{"source":"environment"}'::jsonb)
      `,
      [result.rows[0].id],
    );

    await client.query("COMMIT");
    console.log(`Default-Admin angelegt: ${email}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
