import { Router } from "express";

import { pool } from "../database/pool.js";
import { badRequest, notFound } from "../lib/errors.js";
import { uuidValue } from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const odometerRoutes = Router();
odometerRoutes.use(requireAuth);

function monthValue(value) {
  const month = String(value || "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw badRequest("VALIDATION_ERROR", "month muss YYYY-MM entsprechen.");
  }
  return `${month}-01`;
}

function readingDateValue(value, readingMonth) {
  if (value == null || value === "") return readingMonth;
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw badRequest("VALIDATION_ERROR", "readingDate muss YYYY-MM-DD entsprechen.");
  }
  if (date.slice(0, 7) !== readingMonth.slice(0, 7)) {
    throw badRequest("VALIDATION_ERROR", "Das Ablesedatum muss im ausgewählten Monat liegen.");
  }
  return date;
}

odometerRoutes.get(
  "/pending",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
      WITH previous_month AS (
        SELECT date_trunc('month', current_date - interval '1 month')::date AS month
      )
      SELECT v.id AS vehicle_id, v.name AS vehicle_name, v.license_plate,
             to_char(pm.month, 'YYYY-MM') AS reading_month,
             last_reading.odometer_meters AS last_odometer_meters,
             to_char(last_reading.reading_month, 'YYYY-MM') AS last_reading_month
      FROM vehicles v
      CROSS JOIN previous_month pm
      LEFT JOIN LATERAL (
        SELECT r.id
        FROM vehicle_odometer_readings r
        WHERE r.user_id = v.user_id
          AND r.vehicle_id = v.id
          AND r.reading_date >= pm.month
          AND r.reading_date < (pm.month + interval '1 month')::date
        LIMIT 1
      ) current_reading ON true
      LEFT JOIN LATERAL (
        SELECT r.odometer_meters, r.reading_month
        FROM vehicle_odometer_readings r
        WHERE r.user_id = v.user_id
          AND r.vehicle_id = v.id
          AND r.reading_date < pm.month
        ORDER BY r.reading_date DESC
        LIMIT 1
      ) last_reading ON true
      WHERE v.user_id = $1
        AND v.archived_at IS NULL
        AND v.deregistered_at IS NULL
        AND current_reading.id IS NULL
      ORDER BY v.is_default DESC, lower(v.name)
      `,
      [request.auth.userId],
    );

    response.json(result.rows.map((row) => ({
      vehicleId: row.vehicle_id,
      vehicleName: row.vehicle_name,
      licensePlate: row.license_plate,
      month: row.reading_month,
      lastOdometerKm: row.last_odometer_meters == null ? null : Number(row.last_odometer_meters) / 1000,
      lastReadingMonth: row.last_reading_month,
    })));
  }),
);

odometerRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT r.id, r.vehicle_id, v.name AS vehicle_name, to_char(r.reading_month, 'YYYY-MM') AS reading_month,
              to_char(r.reading_date, 'YYYY-MM-DD') AS reading_date,
              r.odometer_meters, r.source, r.recorded_at
         FROM vehicle_odometer_readings r
         JOIN vehicles v ON v.id = r.vehicle_id AND v.user_id = r.user_id
        WHERE r.user_id = $1
        ORDER BY r.reading_date DESC, lower(v.name)`,
      [request.auth.userId],
    );
    response.json(result.rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      vehicleName: row.vehicle_name,
      month: row.reading_month,
      readingDate: row.reading_date,
      odometerKm: Number(row.odometer_meters) / 1000,
      source: row.source,
      recordedAt: row.recorded_at,
    })));
  }),
);

odometerRoutes.put(
  "/:vehicleId/:month",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.vehicleId);
    const readingMonth = monthValue(request.params.month);
    const readingDate = readingDateValue(request.body?.readingDate, readingMonth);
    const odometerKm = Number(request.body?.odometerKm);
    if (!Number.isFinite(odometerKm) || odometerKm < 0 || odometerKm > 10000000) {
      throw badRequest("VALIDATION_ERROR", "Der Kilometerstand ist ungültig.");
    }

    const vehicle = await pool.query(
      `SELECT id FROM vehicles WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
      [vehicleId, request.auth.userId],
    );
    if (vehicle.rowCount === 0) {
      throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    }

    const odometerMeters = Math.round(odometerKm * 1000);
    const [previous, next] = await Promise.all([
      pool.query(
        `SELECT odometer_meters FROM vehicle_odometer_readings
          WHERE user_id = $1 AND vehicle_id = $2 AND reading_date < $3::date
          ORDER BY reading_date DESC LIMIT 1`,
        [request.auth.userId, vehicleId, readingDate],
      ),
      pool.query(
        `SELECT odometer_meters FROM vehicle_odometer_readings
          WHERE user_id = $1 AND vehicle_id = $2 AND reading_date > $3::date
          ORDER BY reading_date ASC LIMIT 1`,
        [request.auth.userId, vehicleId, readingDate],
      ),
    ]);
    if (previous.rowCount && odometerMeters < Number(previous.rows[0].odometer_meters)) {
      throw badRequest("ODOMETER_REVERSED", "Der Kilometerstand darf nicht kleiner als der vorherige Messwert sein.");
    }
    if (next.rowCount && odometerMeters > Number(next.rows[0].odometer_meters)) {
      throw badRequest("ODOMETER_SEQUENCE", "Der Kilometerstand darf nicht größer als der folgende Messwert sein.");
    }

    const result = await pool.query(
      `INSERT INTO vehicle_odometer_readings
        (user_id, vehicle_id, reading_month, reading_date, odometer_meters, source, recorded_at)
       VALUES ($1, $2, $3, $4, $5, 'manual', now())
       ON CONFLICT (user_id, vehicle_id, reading_date)
       DO UPDATE SET reading_month = EXCLUDED.reading_month,
                     odometer_meters = EXCLUDED.odometer_meters,
                     source = 'manual', recorded_at = now()
       RETURNING id, vehicle_id, to_char(reading_month, 'YYYY-MM') AS reading_month,
                 to_char(reading_date, 'YYYY-MM-DD') AS reading_date,
                 odometer_meters, source, recorded_at`,
      [request.auth.userId, vehicleId, readingMonth, readingDate, odometerMeters],
    );

    const row = result.rows[0];
    response.json({
      id: row.id,
      vehicleId: row.vehicle_id,
      month: row.reading_month,
      readingDate: row.reading_date,
      odometerKm: Number(row.odometer_meters) / 1000,
      source: row.source,
      recordedAt: row.recorded_at,
    });
  }),
);
