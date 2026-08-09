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
import { mapTrip } from "../lib/mappers.js";
import {
  dateQuery,
  isUuid,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getUserSettings } from "../services/userSettingsService.js";
import { getCountryExport, listCountryExports } from "../services/countryExports/index.js";

export const exportRoutes = Router();
export const importRoutes = Router();

exportRoutes.use(requireAuth);
importRoutes.use(requireAuth);

exportRoutes.get(
  "/countries",
  asyncHandler(async (request, response) => {
    const [countries, settings] = await Promise.all([
      listCountryExports(),
      getUserSettings(request.auth.userId),
    ]);
    const selectedCountry = await getCountryExport(
      settings.homeCountry || "DE",
    );

    response.json({
      countries,
      selectedCountry: selectedCountry.toPublicDefinition(new Date()),
    });
  }),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploadLimitBytes,
    files: 1,
  },
});

const TRIP_TYPES = [
  "business",
  "private",
  "commute",
  "unclassified",
];

const TYPE_LABELS = {
  business: "Dienstlich",
  private: "Privat",
  commute: "Arbeitsweg",
  unclassified: "Nicht zugeordnet",
};

function buildExportFilter(request, { allowTripId = false } = {}) {
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
    parameters.push(
      uuidValue(String(request.query.vehicleId), "vehicleId"),
    );
    conditions.push(`t.vehicle_id = $${parameters.length}`);
  }

  if (request.query.type) {
    const type = String(request.query.type);

    if (!TRIP_TYPES.includes(type)) {
      throw badRequest(
        "VALIDATION_ERROR",
        "Der Fahrttyp ist ungültig.",
      );
    }

    parameters.push(type);
    conditions.push(`t.type = $${parameters.length}::trip_type`);
  }

  if (allowTripId && request.query.tripId) {
    parameters.push(
      uuidValue(String(request.query.tripId), "tripId"),
    );
    conditions.push(`t.id = $${parameters.length}`);
  }

  return {
    parameters,
    where: conditions.join(" AND "),
    from,
    to,
  };
}

async function loadExportTrips(request, options = {}) {
  const filter = buildExportFilter(request, options);
  const result = await pool.query(
    `
      SELECT
        t.*,
        v.name AS vehicle_name,
        v.manufacturer,
        v.model,
        v.license_plate,
        v.vin
      FROM trips t
      INNER JOIN vehicles v
        ON v.id = t.vehicle_id
        AND v.user_id = t.user_id
      WHERE ${filter.where}
      ORDER BY t.started_at, t.id
    `,
    filter.parameters,
  );

  return {
    ...filter,
    trips: result.rows,
  };
}

function summarizeTrips(trips) {
  const byType = Object.fromEntries(
    TRIP_TYPES.map((type) => [
      type,
      {
        type,
        tripCount: 0,
        distanceMeters: 0,
      },
    ]),
  );

  let distanceMeters = 0;
  let durationSeconds = 0;
  let missingPurposeCount = 0;
  let missingOdometerCount = 0;
  let changedTripCount = 0;

  for (const trip of trips) {
    const distance = Number(trip.distance_meters || 0);
    distanceMeters += distance;
    durationSeconds += Number(trip.duration_seconds || 0);

    const bucket = byType[trip.type] || byType.unclassified;
    bucket.tripCount += 1;
    bucket.distanceMeters += distance;

    if (
      trip.type === "business" &&
      !String(trip.purpose || "").trim() &&
      !String(trip.contact || "").trim()
    ) {
      missingPurposeCount += 1;
    }

    if (
      trip.start_odometer_meters == null ||
      trip.end_odometer_meters == null
    ) {
      missingOdometerCount += 1;
    }

    if (Number(trip.change_count || 0) > 0) {
      changedTripCount += 1;
    }
  }

  return {
    tripCount: trips.length,
    distanceMeters,
    distanceKm: distanceMeters / 1000,
    durationSeconds,
    missingPurposeCount,
    missingOdometerCount,
    changedTripCount,
    byType: Object.values(byType).map((entry) => ({
      ...entry,
      distanceKm: entry.distanceMeters / 1000,
    })),
  };
}

async function attachChangeCounts(trips) {
  if (trips.length === 0) {
    return trips;
  }

  const result = await pool.query(
    `
      SELECT trip_id, count(*)::integer AS change_count
      FROM trip_change_log
      WHERE trip_id = ANY($1::uuid[])
      GROUP BY trip_id
    `,
    [trips.map((trip) => trip.id)],
  );

  const counts = new Map(
    result.rows.map((row) => [
      row.trip_id,
      Number(row.change_count || 0),
    ]),
  );

  return trips.map((trip) => ({
    ...trip,
    change_count: counts.get(trip.id) || 0,
  }));
}

function formatKm(meters, digits = 1) {
  return (Number(meters || 0) / 1000).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatOdometer(meters) {
  if (meters == null) {
    return "-";
  }

  return (Number(meters) / 1000).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function safeFilenamePart(value) {
  return String(value || "fahrtenbuch")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "fahrtenbuch";
}

exportRoutes.get(
  "/summary",
  asyncHandler(async (request, response) => {
    const loaded = await loadExportTrips(request);
    const trips = await attachChangeCounts(loaded.trips);

    response.json({
      filters: {
        from: loaded.from || null,
        to: loaded.to || null,
        vehicleId: request.query.vehicleId || null,
        type: request.query.type || null,
      },
      summary: summarizeTrips(trips),
    });
  }),
);

exportRoutes.get(
  "/csv",
  asyncHandler(async (request, response) => {
    const { trips } = await loadExportTrips(request);
    const headers = [
      "id",
      "vehicleId",
      "vehicleName",
      "licensePlate",
      "type",
      "startedAt",
      "endedAt",
      "startAddress",
      "endAddress",
      "purpose",
      "contact",
      "startOdometerKm",
      "endOdometerKm",
      "distanceKm",
      "durationSeconds",
      "updatedAt",
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
          trip.started_at?.toISOString?.() || trip.started_at,
          trip.ended_at?.toISOString?.() || trip.ended_at,
          trip.start_address,
          trip.end_address,
          trip.purpose,
          trip.contact,
          trip.start_odometer_meters == null
            ? null
            : Number(trip.start_odometer_meters) / 1000,
          trip.end_odometer_meters == null
            ? null
            : Number(trip.end_odometer_meters) / 1000,
          trip.distance_meters == null
            ? null
            : Number(trip.distance_meters) / 1000,
          trip.duration_seconds,
          trip.updated_at?.toISOString?.() || trip.updated_at,
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
    const { trips } = await loadExportTrips(request, {
      allowTripId: true,
    });

    if (request.query.tripId && trips.length === 0) {
      throw notFound(
        "TRIP_NOT_FOUND",
        "Die Fahrt wurde nicht gefunden.",
      );
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
            </trkpt>
          `.trim(),
        )
        .join("\n");

      trackParts.push(`
        <trk>
          <name>${xmlEscape(
            `${trip.vehicle_name} - ${new Date(trip.started_at).toLocaleString("de-DE")}`,
          )}</name>
          <desc>${xmlEscape(
            `${trip.start_address || ""} -> ${trip.end_address || ""}`,
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
      `attachment; filename="fahrtenbuch-${request.query.tripId || "fahrten"}.gpx"`,
    );
    response.type("application/gpx+xml; charset=utf-8");
    response.send(xml);
  }),
);

function addPdfHeader(document, title, subtitle) {
  document
    .fillColor("#1d1d1d")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(title, 36, 30);

  document
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#666666")
    .text(subtitle, 36, 55, {
      width: 770,
    });

  document
    .moveTo(36, 77)
    .lineTo(806, 77)
    .strokeColor("#dededb")
    .stroke();
}

function addPdfFooter(document) {
  const range = document.bufferedPageRange();

  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    document
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#666666")
      .text(
        `Fahrtenbuch - Seite ${index + 1} von ${range.count}`,
        36,
        566,
        { width: 770, align: "right" },
      );
  }
}

function drawSummary(document, summary, y) {
  const items = [
    ["Fahrten", String(summary.tripCount)],
    ["Gesamt", `${summary.distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`],
    ["Dienstlich", `${summary.byType.find((entry) => entry.type === "business")?.distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 }) || "0"} km`],
    ["Privat", `${summary.byType.find((entry) => entry.type === "private")?.distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 }) || "0"} km`],
    ["Arbeitsweg", `${summary.byType.find((entry) => entry.type === "commute")?.distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 }) || "0"} km`],
  ];

  const width = 770 / items.length;

  items.forEach(([label, value], index) => {
    const x = 36 + index * width;
    document
      .roundedRect(x, y, width - 6, 42, 4)
      .fillAndStroke("#f7f7f5", "#dededb");
    document
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#666666")
      .text(label, x + 8, y + 7, { width: width - 22 });
    document
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#1d1d1d")
      .text(value, x + 8, y + 20, { width: width - 22 });
  });

  return y + 50;
}

function drawTableHeader(document, y) {
  document.rect(36, y, 770, 28).fill("#1d1d1d");
  const columns = [
    ["Datum", 40, 70],
    ["Strecke", 112, 210],
    ["Art / Zweck", 326, 180],
    ["km Start", 510, 62],
    ["km Ende", 575, 62],
    ["Strecke", 640, 58],
    ["Änd.", 702, 45],
    ["Fahrzeug", 750, 52],
  ];

  document.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
  for (const [label, x, width] of columns) {
    document.text(label, x, y + 9, { width, ellipsis: true });
  }

  return y + 28;
}

function drawTripRow(document, trip, y, rowIndex) {
  const route = `${trip.start_address || "Unbekannter Start"} -> ${trip.end_address || "Unbekanntes Ziel"}`;
  const purpose = [TYPE_LABELS[trip.type] || trip.type, trip.purpose, trip.contact]
    .filter(Boolean)
    .join(" - ");
  const height = 38;

  if (rowIndex % 2 === 1) {
    document.rect(36, y, 770, height).fill("#f7f7f5");
  }

  document.font("Helvetica").fontSize(7.2).fillColor("#1d1d1d");
  document.text(
    new Date(trip.started_at).toLocaleString("de-DE", {
      dateStyle: "short",
      timeStyle: "short",
    }),
    40,
    y + 6,
    { width: 68 },
  );
  document.text(route, 112, y + 5, { width: 208, height: 28, ellipsis: true });
  document.text(purpose || "-", 326, y + 5, { width: 178, height: 28, ellipsis: true });
  document.text(formatOdometer(trip.start_odometer_meters), 510, y + 6, { width: 60, align: "right" });
  document.text(formatOdometer(trip.end_odometer_meters), 575, y + 6, { width: 60, align: "right" });
  document.text(`${formatKm(trip.distance_meters)} km`, 640, y + 6, { width: 56, align: "right" });
  document.text(String(trip.change_count || 0), 702, y + 6, { width: 40, align: "center" });
  document.text(trip.license_plate || trip.vehicle_name, 750, y + 5, { width: 52, height: 28, ellipsis: true });
  document.moveTo(36, y + height).lineTo(806, y + height).strokeColor("#dededb").stroke();

  return y + height;
}

exportRoutes.get(
  "/pdf",
  asyncHandler(async (request, response) => {
    const loaded = await loadExportTrips(request);
    const trips = await attachChangeCounts(loaded.trips);
    const summary = summarizeTrips(trips);
    const userLabel =
      request.auth.user.displayName || request.auth.user.email;
    const period = [loaded.from || "Beginn", loaded.to || "heute"].join(" bis ");

    const document = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36,
      bufferPages: true,
      info: {
        Title: `Fahrtenbuch ${period}`,
        Author: userLabel,
        Subject: "Fahrten- und Statistikexport",
        Creator: "Fahrtenbuch",
      },
    });

    const filename = `fahrtenbuch-${safeFilenamePart(loaded.from || "gesamt")}-${safeFilenamePart(loaded.to || new Date().toISOString().slice(0, 10))}.pdf`;
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );

    document.pipe(response);
    addPdfHeader(
      document,
      "Fahrtenbuch - Fahrten- und Statistikbericht",
      `Inhaber: ${userLabel} | Zeitraum: ${period} | Erstellt: ${new Date().toLocaleString("de-DE")}`,
    );

    let y = drawSummary(document, summary, 88);

    const warnings = [];
    if (summary.missingOdometerCount > 0) {
      warnings.push(`${summary.missingOdometerCount} Fahrt(en) ohne vollständigen Start-/Endkilometerstand`);
    }
    if (summary.missingPurposeCount > 0) {
      warnings.push(`${summary.missingPurposeCount} dienstliche Fahrt(en) ohne Zweck oder Kontakt`);
    }
    if (summary.changedTripCount > 0) {
      warnings.push(`${summary.changedTripCount} Fahrt(en) mit dokumentierten Änderungen`);
    }

    if (warnings.length > 0) {
      document
        .roundedRect(36, y, 770, 34, 4)
        .fillAndStroke("#fff0e2", "#f48120");
      document
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#b42318")
        .text("Hinweis zur Vollständigkeit: ", 44, y + 7, { continued: true })
        .font("Helvetica")
        .fillColor("#1d1d1d")
        .text(warnings.join("; "), { width: 746 });
      y += 42;
    }

    y = drawTableHeader(document, y);

    trips.forEach((trip, index) => {
      if (y + 38 > 552) {
        document.addPage();
        addPdfHeader(document, "Fahrtenbuch - Fortsetzung", `Inhaber: ${userLabel} | Zeitraum: ${period}`);
        y = drawTableHeader(document, 88);
      }

      y = drawTripRow(document, trip, y, index);
    });

    if (trips.length === 0) {
      document
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#666666")
        .text("Für die gewählten Filter wurden keine abgeschlossenen Fahrten gefunden.", 36, y + 20, { width: 770, align: "center" });
    }

    addPdfFooter(document);
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
