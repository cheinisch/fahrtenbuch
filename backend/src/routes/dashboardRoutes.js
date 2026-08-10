import { Router } from "express";

import { pool } from "../database/pool.js";
import { badRequest } from "../lib/errors.js";
import { mapTrip } from "../lib/mappers.js";
import {
  dateQuery,
  isUuid,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { TRIP_WITH_TAGS_SELECT } from "../services/tripService.js";

export const dashboardRoutes = Router();

dashboardRoutes.use(requireAuth);

const TRIP_TYPES = [
  "business",
  "private",
  "commute",
  "unclassified",
];

function createFallbackRoute(row) {
  const route = [];

  if (row.start_lat !== null && row.start_lon !== null) {
    route.push({
      latitude: Number(row.start_lat),
      longitude: Number(row.start_lon),
    });
  }

  if (
    row.end_lat !== null &&
    row.end_lon !== null &&
    (row.end_lat !== row.start_lat || row.end_lon !== row.start_lon)
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
  asyncHandler(async (request, response) => {
    const from = dateQuery(request.query.from, "from");
    const to = dateQuery(request.query.to, "to");
    const type = request.query.type ? String(request.query.type) : null;
    const tagId = request.query.tagId ? String(request.query.tagId) : null;

    if (type && !TRIP_TYPES.includes(type)) {
      throw badRequest("VALIDATION_ERROR", "Der Fahrttyp ist ungültig.");
    }

    if (tagId && !isUuid(tagId)) {
      throw badRequest("VALIDATION_ERROR", "Der Tag ist ungültig.");
    }

    const parameters = [request.auth.userId];
    const conditions = [
      "t.user_id = $1",
      "t.archived_at IS NULL",
    ];

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

    if (type) {
      parameters.push(type);
      conditions.push(`t.type = $${parameters.length}::trip_type`);
    }

    if (tagId) {
      parameters.push(tagId);
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM trip_tags selected_tag
          WHERE selected_tag.trip_id = t.id
            AND selected_tag.user_id = t.user_id
            AND selected_tag.tag_id = $${parameters.length}::uuid
        )
      `);
    }

    const whereClause = conditions.join(" AND ");

    const [tripsResult, tagsResult, homeResult, statsResult, monthlyResult, mapDefaultsResult] =
      await Promise.all([
        pool.query(
          `
            SELECT ${TRIP_WITH_TAGS_SELECT}
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
              settings -> 'homeLocation' AS home_location,
              settings -> 'workLocation' AS work_location,
              settings -> 'locationRecognitionRadiusMeters' AS location_recognition_radius_meters
            FROM user_settings
            WHERE user_id = $1
            LIMIT 1
          `,
          [request.auth.userId],
        ),
        pool.query(
          `
            SELECT
              count(*) FILTER (WHERE status = 'completed')::integer AS total_trips,
              coalesce(
                sum(distance_meters) FILTER (WHERE status = 'completed'),
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
          [request.auth.userId],
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
          [request.auth.userId],
        ),
          pool.query(
          `SELECT value FROM app_settings WHERE key = 'map.defaults' LIMIT 1`,
        ),
      ]);

    const tripIds = tripsResult.rows.map((row) => row.id);
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
                  ceil(point_count / 500.0)::bigint
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
        pointsResult.rows.map((row) => [row.trip_id, row.route || []]),
      );
    }

    const trips = tripsResult.rows.map((row) => ({
      ...mapTrip(row),
      vehicle: {
        id: row.vehicle_id,
        name: row.vehicle_name,
      },
      route: routeMap.get(row.id) || createFallbackRoute(row),
    }));

    const stats = statsResult.rows[0];
    const vehicleCountResult = await pool.query(
      `
        SELECT count(*)::integer AS count
        FROM vehicles
        WHERE user_id = $1
          AND archived_at IS NULL
      `,
      [request.auth.userId],
    );

    response.json({
      trips,
      recentTrips: trips.slice(0, 6),
      filters: {
        tags: tagsResult.rows,
      },
      map: {
        homeLocation: homeResult.rows[0]?.home_location || null,
        workLocation: homeResult.rows[0]?.work_location || null,
        locationRecognitionRadiusMeters: Number(
          homeResult.rows[0]?.location_recognition_radius_meters ?? 250,
        ),
        settings: {
          provider: "osm",
          defaultLatitude: 50.1109,
          defaultLongitude: 8.6821,
          defaultZoom: 6,
          protomapsTileServerUrl: "",
          protomapsAssetsUrl: "",
          protomapsFlavor: "auto",
          ...(mapDefaultsResult.rows[0]?.value || {}),
        },
      },
      stats: {
        totalTrips: Number(stats.total_trips || 0),
        totalDistanceMeters: Number(stats.total_distance_meters || 0),
        unclassifiedTrips: Number(stats.unclassified_trips || 0),
        monthTrips: Number(stats.month_trips || 0),
        monthDistanceMeters: Number(stats.month_distance_meters || 0),
        vehicleCount: Number(vehicleCountResult.rows[0].count || 0),
      },
      monthlyDistance: monthlyResult.rows.map((row) => ({
        month: row.month_key,
        distanceMeters: Number(row.distance_meters || 0),
        tripCount: Number(row.trip_count || 0),
      })),
    });
  }),
);
