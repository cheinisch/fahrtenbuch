import { pool } from "./pool.js";
import { hashPassword } from "../security/password.js";

export async function seedDefaultAdmin() {
  const email = process.env.DEFAULT_ADMIN_EMAIL?.trim().toLowerCase();
  const username = process.env.DEFAULT_ADMIN_USERNAME?.trim();
  const displayName =
    process.env.DEFAULT_ADMIN_DISPLAY_NAME?.trim() ||
    username ||
    "Administrator";
  const password = process.env.DEFAULT_ADMIN_PASSWORD;

  if (!email || !username || !password) {
    throw new Error(
      "DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_USERNAME und " +
        "DEFAULT_ADMIN_PASSWORD müssen gesetzt sein.",
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      ["fahrtenbuch-default-admin"],
    );

    const existingUser = await client.query(
      `
        SELECT id
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
      return;
    }

    const passwordHash = await hashPassword(password);

    await client.query(
      `
        INSERT INTO users (
          email,
          username,
          display_name,
          password_hash,
          role,
          status,
          locale,
          timezone,
          theme_mode,
          force_password_change
        )
        VALUES ($1, $2, $3, $4, 'admin', 'active', 'de',
                'Europe/Berlin', 'system', true)
      `,
      [email, username, displayName, passwordHash],
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