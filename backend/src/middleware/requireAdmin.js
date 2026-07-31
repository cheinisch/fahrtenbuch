import { pool } from "../database/pool.js";

export async function requireAdmin(request, response, next) {
  try {
    const result = await pool.query(
      `
        SELECT role, status
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [request.auth.userId],
    );

    const user = result.rows[0];

    if (!user || user.status !== "active" || user.role !== "admin") {
      return response.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Für diesen Bereich sind Administratorrechte erforderlich.",
        },
      });
    }

    request.auth.role = user.role;
    next();
  } catch (error) {
    next(error);
  }
}
