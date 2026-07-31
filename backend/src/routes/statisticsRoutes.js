import { Router } from "express";

import { pool } from "../database/pool.js";
import { badRequest } from "../lib/errors.js";
import {
  dateQuery,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const statisticsRoutes = Router();

statisticsRoutes.use(requireAuth);

function buildConditions(request) {
  const parameters = [request.auth.userId];
  const conditions = [
    "t.user_id = $1",
    "t.archived_at IS NULL",
    "t.status = 'completed'",
  ];

  const from = dateQuery(request.query.from, "from");
  const to = dateQuery(request.query.to, "to");

  if (from) {
    parameters.push(from);
    conditions.push(`t.started_at >= $${parameters.length}::date`);
  }

  if (to) {
    parameters.push(to);
    conditions.push(
      `t.started_at < $${parameters.length}::date + interval '1 day'`,
    );
  }

  if (request.query.vehicleId) {
    parameters.push(uuidValue(String(request.query.vehicleId), "vehicleId"));
    conditions.push(`t.vehicle_id = $${parameters.length}`);
  }

  if (request.query.type) {
    const type = String(request.query.type);

    if (!["business", "private", "commute", "unclassified"].includes(type)) {
      throw badRequest(
        "VALIDATION_ERROR",
        "Der Fahrttyp ist ungültig.",
      );
    }

    parameters.push(type);
    conditions.push(`t.type = $${parameters.length}::trip_type`);
  }

  return { parameters, where: conditions.join(" AND ") };
}

statisticsRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const { parameters, where } = buildConditions(request);

    const [summaryResult, typeResult] = await Promise.all([
      pool.query(
        `
          SELECT
            count(*)::integer AS trip_count,
            coalesce(sum(distance_meters), 0) AS distance_meters,
            coalesce(sum(duration_seconds), 0) AS duration_seconds,
            coalesce(avg(distance_meters), 0) AS average_distance_meters,
            min(started_at) AS first_trip_at,
            max(started_at) AS last_trip_at
          FROM trips t
          WHERE ${where}
        `,
        parameters,
      ),
      pool.query(
        `
          SELECT
            type,
            count(*)::integer AS trip_count,
            coalesce(sum(distance_meters), 0) AS distance_meters,
            coalesce(sum(duration_seconds), 0) AS duration_seconds
          FROM trips t
          WHERE ${where}
          GROUP BY type
          ORDER BY type
        `,
        parameters,
      ),
    ]);

    const summary = summaryResult.rows[0];

    response.json({
      summary: {
        tripCount: Number(summary.trip_count || 0),
        distanceMeters: Number(summary.distance_meters || 0),
        distanceKm: Number(summary.distance_meters || 0) / 1000,
        durationSeconds: Number(summary.duration_seconds || 0),
        averageDistanceMeters: Number(summary.average_distance_meters || 0),
        firstTripAt: summary.first_trip_at,
        lastTripAt: summary.last_trip_at,
      },
      byType: typeResult.rows.map((row) => ({
        type: row.type,
        tripCount: Number(row.trip_count || 0),
        distanceMeters: Number(row.distance_meters || 0),
        distanceKm: Number(row.distance_meters || 0) / 1000,
        durationSeconds: Number(row.duration_seconds || 0),
      })),
    });
  }),
);

statisticsRoutes.get(
  "/monthly",
  asyncHandler(async (request, response) => {
    const months = Number(request.query.months || 12);

    if (!Number.isInteger(months) || months < 1 || months > 120) {
      throw badRequest(
        "VALIDATION_ERROR",
        "Der Parameter „months“ muss zwischen 1 und 120 liegen.",
      );
    }

    const result = await pool.query(
      `
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', now()) - (($2 - 1) || ' months')::interval,
            date_trunc('month', now()),
            interval '1 month'
          ) AS month
        )
        SELECT
          to_char(months.month, 'YYYY-MM') AS month,
          count(t.id)::integer AS trip_count,
          coalesce(sum(t.distance_meters), 0) AS distance_meters,
          coalesce(sum(t.duration_seconds), 0) AS duration_seconds
        FROM months
        LEFT JOIN trips t
          ON date_trunc('month', t.started_at) = months.month
          AND t.user_id = $1
          AND t.status = 'completed'
          AND t.archived_at IS NULL
        GROUP BY months.month
        ORDER BY months.month
      `,
      [request.auth.userId, months],
    );

    response.json(
      result.rows.map((row) => ({
        month: row.month,
        tripCount: Number(row.trip_count || 0),
        distanceMeters: Number(row.distance_meters || 0),
        distanceKm: Number(row.distance_meters || 0) / 1000,
        durationSeconds: Number(row.duration_seconds || 0),
      })),
    );
  }),
);

statisticsRoutes.get(
  "/vehicles",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
        SELECT
          v.id AS vehicle_id,
          v.name AS vehicle_name,
          count(t.id) FILTER (
            WHERE t.status = 'completed'
          )::integer AS trip_count,
          coalesce(
            sum(t.distance_meters) FILTER (
              WHERE t.status = 'completed'
            ),
            0
          ) AS distance_meters,
          coalesce(
            sum(t.duration_seconds) FILTER (
              WHERE t.status = 'completed'
            ),
            0
          ) AS duration_seconds,
          max(t.started_at) AS last_trip_at
        FROM vehicles v
        LEFT JOIN trips t
          ON t.vehicle_id = v.id
          AND t.user_id = v.user_id
          AND t.archived_at IS NULL
        WHERE v.user_id = $1
          AND v.archived_at IS NULL
        GROUP BY v.id
        ORDER BY lower(v.name)
      `,
      [request.auth.userId],
    );

    response.json(
      result.rows.map((row) => ({
        vehicleId: row.vehicle_id,
        vehicleName: row.vehicle_name,
        tripCount: Number(row.trip_count || 0),
        distanceMeters: Number(row.distance_meters || 0),
        distanceKm: Number(row.distance_meters || 0) / 1000,
        durationSeconds: Number(row.duration_seconds || 0),
        lastTripAt: row.last_trip_at,
      })),
    );
  }),
);
