import { randomUUID } from "node:crypto";
import { Router } from "express";
import { parse as parseCsv } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
import multer from "multer";
import PDFDocument from "pdfkit";

import { config } from "../config.js";
import { pool } from "../database/pool.js";
import {
  badRequest,
  notFound,
} from "../lib/errors.js";
import {
  csvCell,
  xmlEscape,
} from "../lib/exportFormat.js";
import { routeDistance } from "../lib/geo.js";
import {
  mapTrip,
} from "../lib/mappers.js";
import {
  isUuid,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const exportRoutes = Router();
export const importRoutes = Router();

exportRoutes.use(requireAuth);
importRoutes.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploadLimitBytes,
    files: 1,
  },
});

async function loadExportTrips(userId, tripId = null) {
  const parameters = [userId];
  let tripCondition = "";

  if (tripId) {
    parameters.push(tripId);
    tripCondition = `AND t.id = $${parameters.length}`;
  }

  const result = await pool.query(
    `
      SELECT
        t.*,
        v.name AS vehicle_name,
        v.license_plate
      FROM trips t
      INNER JOIN vehicles v
        ON v.id = t.vehicle_id
        AND v.user_id = t.user_id
      WHERE t.user_id = $1
        AND t.archived_at IS NULL
        ${tripCondition}
      ORDER BY t.started_at
    `,
    parameters,
  );

  return result.rows;
}

exportRoutes.get(
  "/csv",
  asyncHandler(async (request, response) => {
    const trips = await loadExportTrips(request.auth.userId);
    const headers = [
      "id",
      "vehicleId",
      "vehicleName",
      "licensePlate",
      "type",
      "status",
      "startedAt",
      "endedAt",
      "startAddress",
      "endAddress",
      "purpose",
      "contact",
      "notes",
      "distanceKm",
      "durationSeconds",
    ];

    const lines = [headers.join(";")];

    for (const trip of trips) {
      lines.push(
        [
          trip.id,
          trip.vehicle_id,
          trip.vehicle_name,
          trip.license_plate,
          trip.type,
          trip.status,
          trip.started_at?.toISOString?.() || trip.started_at,
          trip.ended_at?.toISOString?.() || trip.ended_at,
          trip.start_address,
          trip.end_address,
          trip.purpose,
          trip.contact,
          trip.notes,
          trip.distance_meters == null
            ? null
            : Number(trip.distance_meters) / 1000,
          trip.duration_seconds,
        ]
          .map(csvCell)
          .join(";"),
      );
    }

    response.setHeader(
      "Content-Disposition",
      `attachment; filename="fahrtenbuch-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    );
    response.type("text/csv; charset=utf-8");
    response.send(`\uFEFF${lines.join("\r\n")}`);
  }),
);

exportRoutes.get(
  "/gpx",
  asyncHandler(async (request, response) => {
    const tripId = request.query.tripId
      ? uuidValue(String(request.query.tripId), "tripId")
      : null;
    const trips = await loadExportTrips(request.auth.userId, tripId);

    if (tripId && trips.length === 0) {
      throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
    }

    const trackParts = [];

    for (const trip of trips) {
      const pointsResult = await pool.query(
        `
          SELECT *
          FROM track_points
          WHERE trip_id = $1
          ORDER BY sequence_number, recorded_at, id
        `,
        [trip.id],
      );

      if (pointsResult.rowCount === 0) {
        continue;
      }

      const points = pointsResult.rows
        .map(
          (point) => `
            <trkpt lat="${point.lat}" lon="${point.lon}">
              ${point.altitude_meters == null ? "" : `<ele>${point.altitude_meters}</ele>`}
              <time>${new Date(point.recorded_at).toISOString()}</time>
              ${point.speed_mps == null ? "" : `<extensions><speed>${point.speed_mps}</speed></extensions>`}
            </trkpt>
          `.trim(),
        )
        .join("\n");

      trackParts.push(`
        <trk>
          <name>${xmlEscape(
            `${trip.vehicle_name} – ${new Date(trip.started_at).toLocaleString("de-DE")}`,
          )}</name>
          <desc>${xmlEscape(
            `${trip.start_address || ""} → ${trip.end_address || ""}`,
          )}</desc>
          <trkseg>${points}</trkseg>
        </trk>
      `);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fahrtenbuch" xmlns="http://www.topografix.com/GPX/1/1">
${trackParts.join("\n")}
</gpx>`;

    response.setHeader(
      "Content-Disposition",
      `attachment; filename="fahrtenbuch-${tripId || "alle-fahrten"}.gpx"`,
    );
    response.type("application/gpx+xml; charset=utf-8");
    response.send(xml);
  }),
);

exportRoutes.get(
  "/pdf",
  asyncHandler(async (request, response) => {
    const trips = await loadExportTrips(request.auth.userId);
    const document = new PDFDocument({
      size: "A4",
      margin: 42,
      info: {
        Title: "Fahrtenbuch",
        Author: request.auth.user.displayName || request.auth.user.email,
      },
    });

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="fahrtenbuch-${new Date()
        .toISOString()
        .slice(0, 10)}.pdf"`,
    );

    document.pipe(response);
    document.fontSize(22).text("Fahrtenbuch");
    document
      .moveDown(0.4)
      .fontSize(10)
      .fillColor("#666666")
      .text(
        `Erstellt am ${new Date().toLocaleString("de-DE")} für ${
          request.auth.user.displayName || request.auth.user.email
        }`,
      );
    document.moveDown().fillColor("#000000");

    let totalMeters = 0;

    for (const trip of trips) {
      totalMeters += Number(trip.distance_meters || 0);
      document
        .fontSize(12)
        .text(
          `${new Date(trip.started_at).toLocaleString("de-DE")} · ${trip.vehicle_name}`,
          { continued: false },
        );
      document
        .fontSize(9)
        .fillColor("#444444")
        .text(`${trip.start_address || "Unbekannter Start"} → ${trip.end_address || "Unbekanntes Ziel"}`)
        .text(
          `Typ: ${trip.type} · Strecke: ${(
            Number(trip.distance_meters || 0) / 1000
          ).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`,
        );

      if (trip.purpose) {
        document.text(`Zweck: ${trip.purpose}`);
      }

      if (trip.contact) {
        document.text(`Kontakt: ${trip.contact}`);
      }

      document.moveDown(0.8).fillColor("#000000");

      if (document.y > 730) {
        document.addPage();
      }
    }

    document
      .moveDown()
      .fontSize(11)
      .text(
        `Gesamt: ${trips.length} Fahrten · ${(
          totalMeters / 1000
        ).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`,
      );

    document.end();
  }),
);

function parseBoolean(value) {
  return ["true", "1", "yes", "on"].includes(String(value || "").toLowerCase());
}

async function resolveVehicle(client, userId, row) {
  if (row.vehicleId && isUuid(row.vehicleId)) {
    const byId = await client.query(
      `
        SELECT id
        FROM vehicles
        WHERE id = $1
          AND user_id = $2
          AND archived_at IS NULL
        LIMIT 1
      `,
      [row.vehicleId, userId],
    );

    if (byId.rowCount > 0) {
      return byId.rows[0].id;
    }
  }

  if (row.vehicleName) {
    const byName = await client.query(
      `
        SELECT id
        FROM vehicles
        WHERE user_id = $1
          AND archived_at IS NULL
          AND lower(name) = lower($2)
        LIMIT 1
      `,
      [userId, row.vehicleName],
    );

    if (byName.rowCount > 0) {
      return byName.rows[0].id;
    }
  }

  const defaultVehicle = await client.query(
    `
      SELECT id
      FROM vehicles
      WHERE user_id = $1
        AND archived_at IS NULL
      ORDER BY is_default DESC, created_at
      LIMIT 1
    `,
    [userId],
  );

  return defaultVehicle.rows[0]?.id || null;
}

importRoutes.post(
  "/csv",
  upload.single("file"),
  asyncHandler(async (request, response) => {
    if (!request.file) {
      throw badRequest("FILE_REQUIRED", "Eine CSV-Datei ist erforderlich.");
    }

    let rows;

    try {
      rows = parseCsv(request.file.buffer, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: [";", ",", "\t"],
        relax_column_count: true,
      });
    } catch (error) {
      throw badRequest("INVALID_CSV", "Die CSV-Datei konnte nicht gelesen werden.", {
        parserMessage: error.message,
      });
    }

    const dryRun = parseBoolean(request.body?.dryRun);
    const errors = [];
    const prepared = [];
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const line = index + 2;
        const vehicleId = await resolveVehicle(client, request.auth.userId, row);
        const startedAt = new Date(row.startedAt || row.start || row.date || "");
        const endedAt = row.endedAt ? new Date(row.endedAt) : null;
        const type = ["business", "private", "commute", "unclassified"].includes(
          row.type,
        )
          ? row.type
          : "unclassified";

        if (!vehicleId) {
          errors.push({ line, message: "Kein Fahrzeug gefunden." });
          continue;
        }

        if (Number.isNaN(startedAt.getTime())) {
          errors.push({ line, message: "startedAt ist ungültig." });
          continue;
        }

        if (endedAt && Number.isNaN(endedAt.getTime())) {
          errors.push({ line, message: "endedAt ist ungültig." });
          continue;
        }

        prepared.push({
          vehicleId,
          type,
          startedAt,
          endedAt,
          startAddress: row.startAddress || null,
          endAddress: row.endAddress || null,
          purpose: row.purpose || null,
          contact: row.contact || null,
          notes: row.notes || null,
          distanceMeters:
            row.distanceKm === undefined || row.distanceKm === ""
              ? null
              : Math.max(0, Math.round(Number(row.distanceKm) * 1000)),
        });
      }

      if (!dryRun) {
        for (const trip of prepared) {
          await client.query(
            `
              INSERT INTO trips (
                user_id,
                vehicle_id,
                type,
                status,
                started_at,
                ended_at,
                start_address,
                end_address,
                purpose,
                contact,
                notes,
                distance_meters,
                duration_seconds,
                source,
                completed_at
              )
              VALUES (
                $1, $2, $3,
                CASE WHEN $5 IS NULL THEN 'recording' ELSE 'completed' END,
                $4, $5, $6, $7, $8, $9, $10, $11,
                CASE
                  WHEN $5 IS NULL THEN NULL
                  ELSE GREATEST(0, extract(epoch FROM ($5 - $4))::integer)
                END,
                'import',
                CASE WHEN $5 IS NULL THEN NULL ELSE now() END
              )
            `,
            [
              request.auth.userId,
              trip.vehicleId,
              trip.type,
              trip.startedAt,
              trip.endedAt,
              trip.startAddress,
              trip.endAddress,
              trip.purpose,
              trip.contact,
              trip.notes,
              trip.distanceMeters,
            ],
          );
        }
      }

      if (dryRun) {
        await client.query("ROLLBACK");
      } else {
        await client.query("COMMIT");
      }

      response.json({
        dryRun,
        totalRows: rows.length,
        validRows: prepared.length,
        importedRows: dryRun ? 0 : prepared.length,
        errorCount: errors.length,
        errors,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

importRoutes.post(
  "/gpx",
  upload.single("file"),
  asyncHandler(async (request, response) => {
    if (!request.file) {
      throw badRequest("FILE_REQUIRED", "Eine GPX-Datei ist erforderlich.");
    }

    const vehicleId = uuidValue(String(request.body?.vehicleId || ""), "vehicleId");
    const vehicleResult = await pool.query(
      `
        SELECT id
        FROM vehicles
        WHERE id = $1
          AND user_id = $2
          AND archived_at IS NULL
        LIMIT 1
      `,
      [vehicleId, request.auth.userId],
    );

    if (vehicleResult.rowCount === 0) {
      throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    }

    let parsed;

    try {
      parsed = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseTagValue: false,
      }).parse(request.file.buffer.toString("utf8"));
    } catch (error) {
      throw badRequest("INVALID_GPX", "Die GPX-Datei konnte nicht gelesen werden.", {
        parserMessage: error.message,
      });
    }

    const tracks = asArray(parsed?.gpx?.trk);
    const results = [];
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const track of tracks) {
        const segments = asArray(track.trkseg);
        const rawPoints = segments.flatMap((segment) => asArray(segment.trkpt));
        const points = rawPoints
          .map((point) => ({
            lat: Number(point["@_lat"]),
            lon: Number(point["@_lon"]),
            altitude: point.ele === undefined ? null : Number(point.ele),
            recordedAt: new Date(point.time || ""),
          }))
          .filter(
            (point) =>
              Number.isFinite(point.lat) &&
              Number.isFinite(point.lon) &&
              !Number.isNaN(point.recordedAt.getTime()),
          );

        if (points.length === 0) {
          continue;
        }

        const startedAt = points[0].recordedAt;
        const endedAt = points.at(-1).recordedAt;
        const distanceMeters = routeDistance(points);
        const tripResult = await client.query(
          `
            INSERT INTO trips (
              user_id,
              vehicle_id,
              type,
              status,
              started_at,
              ended_at,
              start_lat,
              start_lon,
              end_lat,
              end_lon,
              distance_meters,
              duration_seconds,
              notes,
              source,
              completed_at
            )
            VALUES (
              $1, $2, 'unclassified', 'completed',
              $3, $4, $5, $6, $7, $8, $9, $10, $11, 'import', now()
            )
            RETURNING *
          `,
          [
            request.auth.userId,
            vehicleId,
            startedAt,
            endedAt,
            points[0].lat,
            points[0].lon,
            points.at(-1).lat,
            points.at(-1).lon,
            distanceMeters,
            Math.max(0, Math.round((endedAt - startedAt) / 1000)),
            track.name ? `GPX: ${track.name}` : "GPX-Import",
          ],
        );

        const trip = tripResult.rows[0];
        const payload = points.map((point, index) => ({
          sequence_number: index,
          lat: point.lat,
          lon: point.lon,
          altitude_meters: point.altitude,
          recorded_at: point.recordedAt.toISOString(),
        }));

        await client.query(
          `
            INSERT INTO track_points (
              trip_id,
              sequence_number,
              lat,
              lon,
              altitude_meters,
              recorded_at
            )
            SELECT
              $1,
              point.sequence_number,
              point.lat,
              point.lon,
              point.altitude_meters,
              point.recorded_at
            FROM jsonb_to_recordset($2::jsonb) AS point (
              sequence_number bigint,
              lat double precision,
              lon double precision,
              altitude_meters double precision,
              recorded_at timestamptz
            )
          `,
          [trip.id, JSON.stringify(payload)],
        );

        results.push(mapTrip(trip));
      }

      await client.query("COMMIT");
      response.json({
        importedTrips: results.length,
        trips: results,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
