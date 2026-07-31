import { Router } from "express";

import { pool } from "../database/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const dashboardRoutes = Router();

dashboardRoutes.use(requireAuth);

const TRIP_TYPES = new Set([
  "business",
  "private",
  "commute",
  "unclassified",
]);

function sendError(response, status, code, message) {
  return response.status(status).json({
    error: {
      code,
      message,
    },
  });
}

function isDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    String(value || ""),
  );
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function toNumber(value) {
  return value === null || value === undefined
    ? null
    : Number(value);
}

function createFallbackRoute(row) {
  const route = [];

  if (
    row.start_lat !== null &&
    row.start_lon !== null
  ) {
    route.push({
      latitude: Number(row.start_lat),
      longitude: Number(row.start_lon),
    });
  }

  if (
    row.end_lat !== null &&
    row.end_lon !== null &&
    (
      row.end_lat !== row.start_lat ||
      row.end_lon !== row.start_lon
    )
  ) {
    route.push({
      latitude: Number(row.end_lat),
      longitude: Number(row.end_lon),
    });
  }

  return route;
}

dashboardRoutes.get(
  "/",
  async (request, response, next) => {
    try {
      const from = request.query.from
        ? String(request.query.from)
        : null;

      const to = request.query.to
        ? String(request.query.to)
        : null;

      const type = request.query.type
        ? String(request.query.type)
        : null;

      const tagId = request.query.tagId
        ? String(request.query.tagId)
        : null;

      if (from && !isDateValue(from)) {
        return sendError(
          response,
          400,
          "INVALID_FROM_DATE",
          "Das Startdatum ist ungültig.",
        );
      }

      if (to && !isDateValue(to)) {
        return sendError(
          response,
          400,
          "INVALID_TO_DATE",
          "Das Enddatum ist ungültig.",
        );
      }

      if (type && !TRIP_TYPES.has(type)) {
        return sendError(
          response,
          400,
          "INVALID_TRIP_TYPE",
          "Der gewählte Fahrttyp ist ungültig.",
        );
      }

      if (tagId && !isUuid(tagId)) {
        return sendError(
          response,
          400,
          "INVALID_TAG_ID",
          "Der gewählte Tag ist ungültig.",
        );
      }

      const parameters = [request.auth.userId];
      const conditions = [
        "t.user_id = $1",
        "t.archived_at IS NULL",
      ];

      if (from) {
        parameters.push(from);
        conditions.push(
          `t.started_at >= $${parameters.length}::date`,
        );
      }

      if (to) {
        parameters.push(to);
        conditions.push(
          `t.started_at < (
            $${parameters.length}::date
            + interval '1 day'
          )`,
        );
      }

      if (type) {
        parameters.push(type);
        conditions.push(
          `t.type = $${parameters.length}::trip_type`,
        );
      }

      if (tagId) {
        parameters.push(tagId);
        conditions.push(
          `EXISTS (
            SELECT 1
            FROM trip_tags selected_trip_tag
            WHERE selected_trip_tag.trip_id = t.id
              AND selected_trip_tag.user_id = t.user_id
              AND selected_trip_tag.tag_id =
                $${parameters.length}::uuid
          )`,
        );
      }

      const whereClause = conditions.join("\nAND ");

      const [tripsResult, tagsResult, homeResult] =
        await Promise.all([
          pool.query(
            `
              SELECT
                t.id,
                t.type,
                t.status,
                t.started_at,
                t.ended_at,
                t.start_lat,
                t.start_lon,
                t.end_lat,
                t.end_lon,
                t.start_address,
                t.end_address,
                t.distance_meters,
                t.duration_seconds,
                t.purpose,
                t.notes,
                v.id AS vehicle_id,
                v.name AS vehicle_name,
                COALESCE(
                  jsonb_agg(
                    DISTINCT jsonb_build_object(
                      'id', tag.id,
                      'name', tag.name,
                      'color', tag.color
                    )
                  ) FILTER (
                    WHERE tag.id IS NOT NULL
                  ),
                  '[]'::jsonb
                ) AS tags
              FROM trips t
              INNER JOIN vehicles v
                ON v.id = t.vehicle_id
                AND v.user_id = t.user_id
              LEFT JOIN trip_tags tt
                ON tt.trip_id = t.id
                AND tt.user_id = t.user_id
              LEFT JOIN tags tag
                ON tag.id = tt.tag_id
                AND tag.user_id = t.user_id
              WHERE ${whereClause}
              GROUP BY t.id, v.id
              ORDER BY t.started_at DESC
            `,
            parameters,
          ),

          pool.query(
            `
              SELECT id, name, color
              FROM tags
              WHERE user_id = $1
              ORDER BY lower(name)
            `,
            [request.auth.userId],
          ),

          pool.query(
            `
              SELECT
                settings -> 'homeLocation'
                  AS home_location
              FROM user_settings
              WHERE user_id = $1
              LIMIT 1
            `,
            [request.auth.userId],
          ),
        ]);

      const tripIds = tripsResult.rows.map(
        (row) => row.id,
      );

      let routeMap = new Map();

      if (tripIds.length > 0) {
        const pointsResult = await pool.query(
          `
            WITH numbered_points AS (
              SELECT
                tp.trip_id,
                tp.sequence_number,
                tp.lat,
                tp.lon,
                row_number() OVER (
                  PARTITION BY tp.trip_id
                  ORDER BY tp.sequence_number
                ) AS point_index,
                count(*) OVER (
                  PARTITION BY tp.trip_id
                ) AS point_count
              FROM track_points tp
              WHERE tp.trip_id = ANY($1::uuid[])
            ),
            sampled_points AS (
              SELECT *
              FROM numbered_points
              WHERE
                point_index = 1
                OR point_index = point_count
                OR mod(
                  point_index - 1,
                  GREATEST(
                    1,
                    ceil(
                      point_count / 500.0
                    )::bigint
                  )
                ) = 0
            )
            SELECT
              trip_id,
              jsonb_agg(
                jsonb_build_object(
                  'latitude', lat,
                  'longitude', lon
                )
                ORDER BY sequence_number
              ) AS route
            FROM sampled_points
            GROUP BY trip_id
          `,
          [tripIds],
        );

        routeMap = new Map(
          pointsResult.rows.map((row) => [
            row.trip_id,
            row.route || [],
          ]),
        );
      }

      const trips = tripsResult.rows.map((row) => {
        const route =
          routeMap.get(row.id) ||
          createFallbackRoute(row);

        return {
          id: row.id,
          type: row.type,
          status: row.status,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          startAddress: row.start_address,
          endAddress: row.end_address,
          distanceMeters:
            toNumber(row.distance_meters) || 0,
          durationSeconds:
            toNumber(row.duration_seconds) || 0,
          purpose: row.purpose,
          notes: row.notes,
          vehicle: {
            id: row.vehicle_id,
            name: row.vehicle_name,
          },
          tags: row.tags || [],
          route,
        };
      });

      response.json({
        trips,
        filters: {
          tags: tagsResult.rows.map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color,
          })),
        },
        map: {
          homeLocation:
            homeResult.rows[0]?.home_location ||
            null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
