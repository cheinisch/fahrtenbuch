import { Router } from "express";
import { pool } from "../database/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  mapUser,
  USER_PUBLIC_COLUMNS,
} from "../users/userMapper.js";

export const userRoutes = Router();

userRoutes.use(requireAuth);

userRoutes.get("/me", async (request, response, next) => {
  try {
    const result = await pool.query(
      `
        SELECT ${USER_PUBLIC_COLUMNS}
        FROM users u
        WHERE u.id = $1
          AND u.status = 'active'
          AND u.deleted_at IS NULL
        LIMIT 1
      `,
      [request.auth.userId],
    );

    if (result.rowCount === 0) {
      return response.status(404).json({
        error: {
          code: "USER_NOT_FOUND",
          message: "Der Benutzer wurde nicht gefunden.",
        },
      });
    }

    return response.json(mapUser(result.rows[0]));
  } catch (error) {
    next(error);
  }
});