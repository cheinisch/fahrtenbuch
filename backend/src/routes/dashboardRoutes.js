import { Router } from "express";

import { pool } from "../database/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const dashboardRoutes = Router();

dashboardRoutes.use(requireAuth);

function toNumber(value) {
  return Number(value || 0);
}

dashboardRoutes.get("/", async (request, response, next) => {
  try {
    const userId = request.auth.userId;

    const [statsResult, vehiclesResult, recentResult, monthlyResult] =
      await Promise.all([
        pool.query(
          `
            SELECT
              count(*) FILTER (
                WHERE status = 'completed'
              )::integer AS total_trips,

              coalesce(
                sum(distance_meters) FILTER (
                  WHERE status = 'completed'
                ),
                0
              ) AS total_distance_meters,

              count(*) FILTER (
                WHERE type = 'unclassified'
                  AND status <> 'cancelled'
              )::integer AS unclassified_trips,

              count(*) FILTER (
                WHERE status = 'completed'
                  AND started_at >= date_trunc('month', now())
              )::integer AS month_trips,

              coalesce(
                sum(distance_meters) FILTER (
                  WHERE status = 'completed'
                    AND started_at >= date_trunc('month', now())
                ),
                0
              ) AS month_distance_meters
            FROM trips
            WHERE user_id = $1
              AND archived_at IS NULL
          `,
          [userId],
        ),

        pool.query(
          `
            SELECT count(*)::integer AS vehicle_count
            FROM vehicles
            WHERE user_id = $1
              AND archived_at IS NULL
          `,
          [userId],
        ),

        pool.query(
          `
            SELECT
              t.id,
              t.type,
              t.status,
              t.started_at,
              t.ended_at,
              t.start_address,
              t.end_address,
              t.distance_meters,
              t.duration_seconds,
              v.id AS vehicle_id,
              v.name AS vehicle_name
            FROM trips t
            INNER JOIN vehicles v
              ON v.id = t.vehicle_id
            WHERE t.user_id = $1
              AND t.archived_at IS NULL
            ORDER BY t.started_at DESC
            LIMIT 6
          `,
          [userId],
        ),

        pool.query(
          `
            WITH months AS (
              SELECT generate_series(
                date_trunc('month', now()) - interval '5 months',
                date_trunc('month', now()),
                interval '1 month'
              ) AS month
            )
            SELECT
              to_char(months.month, 'YYYY-MM') AS month_key,
              coalesce(sum(t.distance_meters), 0) AS distance_meters,
              count(t.id)::integer AS trip_count
            FROM months
            LEFT JOIN trips t
              ON date_trunc('month', t.started_at) = months.month
              AND t.user_id = $1
              AND t.status = 'completed'
              AND t.archived_at IS NULL
            GROUP BY months.month
            ORDER BY months.month
          `,
          [userId],
        ),
      ]);

    const stats = statsResult.rows[0];
    const vehicles = vehiclesResult.rows[0];

    response.json({
      stats: {
        totalTrips: toNumber(stats.total_trips),
        totalDistanceMeters: toNumber(stats.total_distance_meters),
        unclassifiedTrips: toNumber(stats.unclassified_trips),
        monthTrips: toNumber(stats.month_trips),
        monthDistanceMeters: toNumber(stats.month_distance_meters),
        vehicleCount: toNumber(vehicles.vehicle_count),
      },
      recentTrips: recentResult.rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        startAddress: row.start_address,
        endAddress: row.end_address,
        distanceMeters: toNumber(row.distance_meters),
        durationSeconds: toNumber(row.duration_seconds),
        vehicle: {
          id: row.vehicle_id,
          name: row.vehicle_name,
        },
      })),
      monthlyDistance: monthlyResult.rows.map((row) => ({
        month: row.month_key,
        distanceMeters: toNumber(row.distance_meters),
        tripCount: toNumber(row.trip_count),
      })),
    });
  } catch (error) {
    next(error);
  }
});
