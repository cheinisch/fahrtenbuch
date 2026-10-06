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


statisticsRoutes.get(
  "/odometer-intervals",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(String(request.query.vehicleId || ""), "vehicleId");
    const months = Number(request.query.months || 18);
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      throw badRequest("VALIDATION_ERROR", "Der Parameter „months“ muss zwischen 1 und 120 liegen.");
    }

    const result = await pool.query(
      `
      WITH readings AS (
        SELECT r.id, r.vehicle_id, r.reading_date, r.odometer_meters,
               lead(r.id) OVER (PARTITION BY r.vehicle_id ORDER BY r.reading_date) AS next_id,
               lead(r.reading_date) OVER (PARTITION BY r.vehicle_id ORDER BY r.reading_date) AS next_date,
               lead(r.odometer_meters) OVER (PARTITION BY r.vehicle_id ORDER BY r.reading_date) AS next_meter
        FROM vehicle_odometer_readings r
        WHERE r.user_id = $1 AND r.vehicle_id = $2
      ),
      intervals AS (
        SELECT * FROM readings
        WHERE next_id IS NOT NULL
          AND next_date >= date_trunc('month', current_date) - (($3 - 1) || ' months')::interval
      )
      SELECT i.id AS start_reading_id, i.next_id AS end_reading_id,
             to_char(i.reading_date, 'YYYY-MM-DD') AS start_date,
             to_char(i.next_date, 'YYYY-MM-DD') AS end_date,
             i.odometer_meters AS start_meter, i.next_meter AS end_meter,
             coalesce(sum(t.distance_meters), 0)::bigint AS tracked_meters,
             coalesce(sum(t.distance_meters) FILTER (WHERE t.type='business'), 0)::bigint AS business_meters,
             coalesce(sum(t.distance_meters) FILTER (WHERE t.type='private'), 0)::bigint AS private_meters,
             coalesce(sum(t.distance_meters) FILTER (WHERE t.type='commute'), 0)::bigint AS commute_meters,
             coalesce(sum(t.distance_meters) FILTER (WHERE t.type='unclassified'), 0)::bigint AS unclassified_meters,
             count(t.id)::int AS trip_count
      FROM intervals i
      LEFT JOIN trips t
        ON t.user_id=$1 AND t.vehicle_id=i.vehicle_id
       AND t.archived_at IS NULL AND t.status='completed'
       AND t.started_at >= i.reading_date::timestamp
       AND t.started_at < (i.next_date::timestamp + interval '1 day')
      GROUP BY i.id, i.next_id, i.reading_date, i.next_date, i.odometer_meters, i.next_meter
      ORDER BY i.reading_date DESC
      `,
      [request.auth.userId, vehicleId, months],
    );

    response.json(result.rows.map((row) => {
      const actual = Number(row.end_meter) - Number(row.start_meter);
      const tracked = Number(row.tracked_meters || 0);
      return {
        startReadingId: row.start_reading_id,
        endReadingId: row.end_reading_id,
        startDate: row.start_date,
        endDate: row.end_date,
        startOdometerKm: Number(row.start_meter) / 1000,
        endOdometerKm: Number(row.end_meter) / 1000,
        actualKm: actual / 1000,
        trackedKm: tracked / 1000,
        differenceKm: (actual - tracked) / 1000,
        businessKm: Number(row.business_meters || 0) / 1000,
        privateKm: Number(row.private_meters || 0) / 1000,
        commuteKm: Number(row.commute_meters || 0) / 1000,
        unclassifiedKm: Number(row.unclassified_meters || 0) / 1000,
        tripCount: Number(row.trip_count || 0),
      };
    }));
  }),
);

statisticsRoutes.get(
  "/monthly-odometer",
  asyncHandler(async (request, response) => {
    const months = Number(request.query.months || 12);
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      throw badRequest("VALIDATION_ERROR", "Der Parameter „months“ muss zwischen 1 und 120 liegen.");
    }

    const result = await pool.query(
      `
      WITH month_series AS (
        SELECT generate_series(
          date_trunc('month', current_date) - (($2 - 1) || ' months')::interval,
          date_trunc('month', current_date),
          interval '1 month'
        )::date AS month
      ),
      vehicle_months AS (
        SELECT v.id AS vehicle_id, v.name AS vehicle_name, m.month
        FROM vehicles v CROSS JOIN month_series m
        WHERE v.user_id = $1 AND v.archived_at IS NULL
      ),
      distances AS (
        SELECT vehicle_id, date_trunc('month', started_at)::date AS month,
          coalesce(sum(distance_meters), 0)::bigint AS tracked_meters,
          coalesce(sum(distance_meters) FILTER (WHERE type = 'business'), 0)::bigint AS business_meters,
          coalesce(sum(distance_meters) FILTER (WHERE type = 'private'), 0)::bigint AS private_meters,
          coalesce(sum(distance_meters) FILTER (WHERE type = 'commute'), 0)::bigint AS commute_meters,
          coalesce(sum(distance_meters) FILTER (WHERE type = 'unclassified'), 0)::bigint AS unclassified_meters
        FROM trips
        WHERE user_id = $1 AND archived_at IS NULL AND status = 'completed'
        GROUP BY vehicle_id, date_trunc('month', started_at)
      )
      SELECT vm.vehicle_id, vm.vehicle_name, vm.month,
        d.tracked_meters, d.business_meters, d.private_meters, d.commute_meters, d.unclassified_meters,
        start_r.odometer_meters AS start_odometer_meters,
        end_r.odometer_meters AS end_odometer_meters
      FROM vehicle_months vm
      LEFT JOIN distances d ON d.vehicle_id = vm.vehicle_id AND d.month = vm.month
      LEFT JOIN LATERAL (
        SELECT r.odometer_meters
        FROM vehicle_odometer_readings r
        WHERE r.user_id = $1 AND r.vehicle_id = vm.vehicle_id
          AND r.reading_date < vm.month
        ORDER BY r.reading_date DESC
        LIMIT 1
      ) start_r ON true
      LEFT JOIN LATERAL (
        SELECT r.odometer_meters
        FROM vehicle_odometer_readings r
        WHERE r.user_id = $1 AND r.vehicle_id = vm.vehicle_id
          AND r.reading_date < (vm.month + interval '1 month')::date
        ORDER BY r.reading_date DESC
        LIMIT 1
      ) end_r ON true
      ORDER BY vm.month DESC, lower(vm.vehicle_name)
      `,
      [request.auth.userId, months],
    );

    response.json(result.rows.map((row) => {
      const tracked = Number(row.tracked_meters || 0);
      const actual = row.start_odometer_meters == null || row.end_odometer_meters == null
        ? null
        : Math.max(0, Number(row.end_odometer_meters) - Number(row.start_odometer_meters));
      return {
        vehicleId: row.vehicle_id,
        vehicleName: row.vehicle_name,
        month: new Date(row.month).toISOString().slice(0, 7),
        actualKm: actual == null ? null : actual / 1000,
        trackedKm: tracked / 1000,
        businessKm: Number(row.business_meters || 0) / 1000,
        privateKm: Number(row.private_meters || 0) / 1000,
        commuteKm: Number(row.commute_meters || 0) / 1000,
        unclassifiedKm: Number(row.unclassified_meters || 0) / 1000,
        unknownKm: actual == null ? null : Math.max(0, actual - tracked) / 1000,
        startOdometerKm: row.start_odometer_meters == null ? null : Number(row.start_odometer_meters) / 1000,
        endOdometerKm: row.end_odometer_meters == null ? null : Number(row.end_odometer_meters) / 1000,
      };
    }));
  }),
);
