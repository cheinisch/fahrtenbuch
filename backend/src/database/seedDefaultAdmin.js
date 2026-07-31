import { pool } from "./pool.js";
import { hashPassword } from "../security/password.js";

function readRequiredEnvironment(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} muss in der .env gesetzt sein.`);
  }

  return value;
}

function readBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
}

export async function seedDefaultAdmin() {
  const email = readRequiredEnvironment("DEFAULT_ADMIN_EMAIL").toLowerCase();
  const username = readRequiredEnvironment("DEFAULT_ADMIN_USERNAME");
  const password = readRequiredEnvironment("DEFAULT_ADMIN_PASSWORD");

  // Unterstützt beide bisher verwendeten Schreibweisen.
  const displayName =
    process.env.DEFAULT_ADMIN_DISPLAYNAME?.trim() ||
    process.env.DEFAULT_ADMIN_DISPLAY_NAME?.trim() ||
    username;

  const forcePasswordChange = readBoolean(
    process.env.FORCE_ADMIN_PASSWORD_CHANGE,
    true,
  );

  // Das Passwort wird vor jedem Datenbankzugriff mit scrypt gehasht.
  // Der Klartext wird niemals gespeichert oder protokolliert.
  const passwordHash = await hashPassword(password);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verhindert bei mehreren gleichzeitigen App-Instanzen doppelte Seeds.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      ["fahrtenbuch-default-admin"],
    );

    const existingUser = await client.query(
      `
        SELECT id, email, username
        FROM users
        WHERE deleted_at IS NULL
          AND (
            lower(email) = lower($1)
            OR lower(username) = lower($2)
          )
        LIMIT 1
      `,
      [email, username],
    );

    if (existingUser.rowCount > 0) {
      await client.query("COMMIT");
      console.log("Default-Admin ist bereits vorhanden.");
      return existingUser.rows[0].id;
    }

    const insertedUser = await client.query(
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
          $1,
          $2,
          $3,
          $4,
          now(),
          'admin',
          'active',
          'de',
          COALESCE(NULLIF($5, ''), 'Europe/Berlin'),
          'system',
          $6
        )
        RETURNING id
      `,
      [
        email,
        username,
        displayName,
        passwordHash,
        process.env.TZ || "Europe/Berlin",
        forcePasswordChange,
      ],
    );

    const userId = insertedUser.rows[0].id;

    await client.query(
      `
        INSERT INTO user_settings (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
      `,
      [userId],
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
        VALUES (
          $1,
          'user.created.default_admin',
          'user',
          $1,
          '{"source":"environment"}'::jsonb
        )
      `,
      [userId],
    );

    await client.query("COMMIT");
    console.log(`Default-Admin angelegt: ${email}`);

    return userId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
