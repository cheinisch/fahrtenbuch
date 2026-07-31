import { pool } from "../database/pool.js";

export async function meController(req, res) {
  const result = await pool.query(
    `SELECT id, email, login_name AS "loginName", display_name AS "displayName",
            first_name AS "firstName", last_name AS "lastName", role, locale,
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE id=$1`,
    [req.user.sub]
  );
  res.json(result.rows[0] || null);
}
