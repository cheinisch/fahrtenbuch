import { Router } from "express";

import { config } from "../config.js";
import { pool } from "../database/pool.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const healthRoutes = Router();

healthRoutes.get(
  "/",
  asyncHandler(async (_request, response) => {
    const result = await pool.query(`SELECT 1 AS ok`);

    response.json({
      status: result.rows[0]?.ok === 1 ? "ok" : "degraded",
      version: config.version,
      database: result.rows[0]?.ok === 1 ? "ok" : "error",
    });
  }),
);
