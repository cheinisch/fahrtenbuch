import { Router } from "express";

import { pool } from "../database/pool.js";
import {
  conflict,
  notFound,
} from "../lib/errors.js";
import { mapTag } from "../lib/mappers.js";
import {
  objectBody,
  stringField,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const tagRoutes = Router();

tagRoutes.use(requireAuth);

function parseTagInput(body) {
  const input = objectBody(body);

  return {
    name: stringField(input, "name", {
      required: true,
      minimum: 1,
      maximum: 64,
    }),
    color: stringField(input, "color", {
      nullable: true,
      maximum: 64,
    }),
  };
}

tagRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
        SELECT *
        FROM tags
        WHERE user_id = $1
        ORDER BY lower(name)
      `,
      [request.auth.userId],
    );

    response.json(result.rows.map(mapTag));
  }),
);

tagRoutes.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = parseTagInput(request.body);

    try {
      const result = await pool.query(
        `
          INSERT INTO tags (user_id, name, color)
          VALUES ($1, $2, $3)
          RETURNING *
        `,
        [request.auth.userId, input.name, input.color],
      );

      response.status(201).json(mapTag(result.rows[0]));
    } catch (error) {
      if (error?.constraint === "tags_name_unique_per_user") {
        throw conflict(
          "TAG_ALREADY_EXISTS",
          "Ein Tag mit diesem Namen existiert bereits.",
        );
      }

      throw error;
    }
  }),
);

tagRoutes.put(
  "/:id",
  asyncHandler(async (request, response) => {
    const tagId = uuidValue(request.params.id);
    const input = parseTagInput(request.body);

    try {
      const result = await pool.query(
        `
          UPDATE tags
          SET name = $3, color = $4
          WHERE id = $1 AND user_id = $2
          RETURNING *
        `,
        [tagId, request.auth.userId, input.name, input.color],
      );

      if (result.rowCount === 0) {
        throw notFound("TAG_NOT_FOUND", "Der Tag wurde nicht gefunden.");
      }

      response.json(mapTag(result.rows[0]));
    } catch (error) {
      if (error?.constraint === "tags_name_unique_per_user") {
        throw conflict(
          "TAG_ALREADY_EXISTS",
          "Ein Tag mit diesem Namen existiert bereits.",
        );
      }

      throw error;
    }
  }),
);

tagRoutes.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const tagId = uuidValue(request.params.id);
    const result = await pool.query(
      `DELETE FROM tags WHERE id = $1 AND user_id = $2 RETURNING id`,
      [tagId, request.auth.userId],
    );

    if (result.rowCount === 0) {
      throw notFound("TAG_NOT_FOUND", "Der Tag wurde nicht gefunden.");
    }

    response.status(204).end();
  }),
);
