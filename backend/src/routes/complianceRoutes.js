import { Router } from "express";

import { pool } from "../database/pool.js";
import { badRequest } from "../lib/errors.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const complianceRoutes = Router();
complianceRoutes.use(requireAuth);

function parseDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw badRequest("VALIDATION_ERROR", `${name} muss YYYY-MM-DD entsprechen.`);
  }
  return String(value);
}

async function calculateIntegrity(userId) {
  const result = await pool.query(
    `SELECT id, trip_id, actor_user_id, event_type, changed_fields, old_values,
            new_values, metadata, created_at, previous_hash, entry_hash,
            trip_history_hash_payload(
              trip_id, user_id, actor_user_id, event_type, changed_fields,
              old_values, new_values, metadata, created_at, previous_hash
            ) AS calculated_hash
       FROM trip_history
      WHERE user_id = $1
      ORDER BY id ASC`,
    [userId],
  );

  let previous = null;
  const failures = [];
  for (const row of result.rows) {
    if (row.previous_hash !== previous || row.entry_hash !== row.calculated_hash) {
      failures.push({
        historyId: String(row.id),
        tripId: row.trip_id,
        reason: row.previous_hash !== previous ? "CHAIN_BROKEN" : "HASH_MISMATCH",
      });
    }
    previous = row.entry_hash;
  }

  return {
    valid: failures.length === 0,
    entries: result.rows.length,
    headHash: previous,
    failures,
  };
}

complianceRoutes.get(
  "/integrity",
  asyncHandler(async (request, response) => {
    response.json(await calculateIntegrity(request.auth.userId));
  }),
);

complianceRoutes.get(
  "/periods",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT id, period_start, period_end, label, closed_at, integrity_hash
         FROM trip_period_locks
        WHERE user_id = $1
        ORDER BY period_start DESC`,
      [request.auth.userId],
    );
    response.json(result.rows.map((row) => ({
      id: row.id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      label: row.label,
      closedAt: row.closed_at,
      integrityHash: row.integrity_hash,
    })));
  }),
);

complianceRoutes.post(
  "/periods",
  asyncHandler(async (request, response) => {
    const periodStart = parseDate(request.body?.periodStart, "periodStart");
    const periodEnd = parseDate(request.body?.periodEnd, "periodEnd");
    const label = String(request.body?.label || "").trim().slice(0, 120) || null;
    if (periodEnd < periodStart) {
      throw badRequest("VALIDATION_ERROR", "Das Periodenende liegt vor dem Beginn.");
    }

    const unfinished = await pool.query(
      `SELECT count(*)::int AS count
         FROM trips
        WHERE user_id = $1
          AND archived_at IS NULL
          AND started_at::date BETWEEN $2::date AND $3::date
          AND (status <> 'completed' OR type = 'unclassified')`,
      [request.auth.userId, periodStart, periodEnd],
    );
    if (unfinished.rows[0].count > 0) {
      throw badRequest(
        "PERIOD_INCOMPLETE",
        `Der Zeitraum enthält noch ${unfinished.rows[0].count} nicht abgeschlossene oder unklassifizierte Fahrten.`,
      );
    }

    const integrity = await calculateIntegrity(request.auth.userId);
    if (!integrity.valid) {
      throw badRequest("INTEGRITY_FAILED", "Die Fahrtenhistorie ist nicht integer.");
    }

    const result = await pool.query(
      `INSERT INTO trip_period_locks (
          user_id, period_start, period_end, label, closed_by, integrity_hash
        ) VALUES ($1, $2, $3, $4, $1, $5)
        RETURNING id, period_start, period_end, label, closed_at, integrity_hash`,
      [request.auth.userId, periodStart, periodEnd, label, integrity.headHash],
    );

    const row = result.rows[0];
    response.status(201).json({
      id: row.id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      label: row.label,
      closedAt: row.closed_at,
      integrityHash: row.integrity_hash,
    });
  }),
);

complianceRoutes.get(
  "/checks",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
      WITH ordered AS (
        SELECT t.*,
          lag(t.ended_at) OVER (PARTITION BY t.vehicle_id ORDER BY t.started_at, t.id) AS previous_end,
          lag(t.end_odometer_meters) OVER (PARTITION BY t.vehicle_id ORDER BY t.started_at, t.id) AS previous_odometer
        FROM trips t
        WHERE t.user_id = $1 AND t.archived_at IS NULL
      )
      SELECT id, started_at, type, status, start_address, end_address, purpose,
             contact, start_odometer_meters, end_odometer_meters,
             previous_end, previous_odometer
      FROM ordered
      ORDER BY started_at DESC
      `,
      [request.auth.userId],
    );

    const issues = [];
    for (const trip of result.rows) {
      const add = (severity, code, message) =>
        issues.push({ tripId: trip.id, startedAt: trip.started_at, severity, code, message });

      if (trip.status !== "completed") add("warning", "NOT_COMPLETED", "Fahrt ist noch nicht abgeschlossen.");
      if (trip.type === "unclassified") add("error", "UNCLASSIFIED", "Fahrt ist noch nicht klassifiziert.");
      if (!trip.start_address || !trip.end_address) add("warning", "MISSING_ADDRESS", "Start- oder Zieladresse fehlt.");
      if (trip.type === "business" && !trip.purpose) add("error", "MISSING_PURPOSE", "Geschäftsfahrt ohne Zweck.");
      if (trip.type === "business" && !trip.contact) add("warning", "MISSING_CONTACT", "Geschäftsfahrt ohne Kontakt/Geschäftspartner.");
      if (trip.previous_end && new Date(trip.started_at) < new Date(trip.previous_end)) add("error", "OVERLAP", "Fahrt überschneidet sich zeitlich mit der vorherigen Fahrt.");
      if (trip.start_odometer_meters != null && trip.end_odometer_meters != null &&
          Number(trip.end_odometer_meters) < Number(trip.start_odometer_meters)) {
        add("error", "ODOMETER_REVERSED", "Endkilometerstand liegt vor dem Startkilometerstand.");
      }
      if (trip.previous_odometer != null && trip.start_odometer_meters != null &&
          Number(trip.start_odometer_meters) < Number(trip.previous_odometer)) {
        add("error", "ODOMETER_SEQUENCE", "Kilometerstand ist gegenüber der vorherigen Fahrt zurückgegangen.");
      }
    }

    const integrity = await calculateIntegrity(request.auth.userId);
    response.json({
      summary: {
        errors: issues.filter((item) => item.severity === "error").length,
        warnings: issues.filter((item) => item.severity === "warning").length,
        integrityValid: integrity.valid,
      },
      integrity,
      issues,
    });
  }),
);
