import { Router } from "express";

import { pool } from "../database/pool.js";
import {
  badRequest,
  conflict,
  notFound,
} from "../lib/errors.js";
import { mapTrip } from "../lib/mappers.js";
import {
  arrayField,
  dateTimeField,
  enumField,
  numberField,
  objectBody,
  uuidField,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  ensureOwnedVehicle,
  getOwnedTrip,
  recalculateTripMetrics,
  replaceTripTags,
} from "../services/tripService.js";

export const trackingRoutes = Router();

trackingRoutes.use(requireAuth);

trackingRoutes.post(
  "/start",
  asyncHandler(async (request, response) => {
    const body = objectBody(
      request.body,
    );
    const vehicleId = uuidField(
      body,
      "vehicleId",
      true,
    );
    const startedAt =
      dateTimeField(
        body,
        "startedAt",
        { nullable: true },
      ) || new Date();

    const category =
      body.category !== undefined
        ? enumField(
            body,
            "category",
            [
              "business",
              "private",
              "commute",
              "unclassified",
            ],
            { required: true },
          )
        : enumField(
            body,
            "type",
            [
              "business",
              "private",
              "commute",
              "unclassified",
            ],
          ) || "unclassified";

    const rawTagIds =
      arrayField(
        body,
        "tagIds",
        { maximum: 100 },
      ) || [];

    const tagIds = [
      ...new Set(
        rawTagIds.map((tagId) =>
          uuidValue(
            String(tagId),
            "tagId",
          ),
        ),
      ),
    ];

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (
        !(await ensureOwnedVehicle(
          client,
          request.auth.userId,
          vehicleId,
        ))
      ) {
        throw badRequest(
          "VEHICLE_NOT_FOUND",
          "Das Fahrzeug wurde nicht gefunden.",
        );
      }

      const existing = await client.query(
        `
          SELECT id
          FROM trips
          WHERE user_id = $1
            AND status = 'recording'
            AND archived_at IS NULL
          LIMIT 1
        `,
        [request.auth.userId],
      );

      if (existing.rowCount > 0) {
        throw conflict(
          "TRACKING_ALREADY_ACTIVE",
          "Es wird bereits eine Fahrt aufgezeichnet.",
          {
            tripId:
              existing.rows[0].id,
          },
        );
      }

      const result = await client.query(
        `
          INSERT INTO trips (
            user_id,
            vehicle_id,
            type,
            status,
            started_at,
            source
          )
          VALUES (
            $1,
            $2,
            $3,
            'recording',
            $4,
            'android'
          )
          RETURNING id
        `,
        [
          request.auth.userId,
          vehicleId,
          category,
          startedAt,
        ],
      );

      await replaceTripTags(
        client,
        request.auth.userId,
        result.rows[0].id,
        tagIds,
      );

      const trip = await getOwnedTrip(
        client,
        request.auth.userId,
        result.rows[0].id,
      );

      await client.query("COMMIT");

      response
        .status(201)
        .json(mapTrip(trip));
    } catch (error) {
      await client.query("ROLLBACK");

      if (error?.code === "TAG_NOT_FOUND") {
        throw badRequest(
          "TAG_NOT_FOUND",
          error.message,
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }),
);

trackingRoutes.post(
  "/points",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const tripId = uuidField(body, "tripId", true);
    const points = arrayField(body, "points", {
      required: true,
      minimum: 1,
      maximum: 5000,
    }).map((point, index) => {
      const item = objectBody(point);

      return {
        lat: numberField(item, "lat", {
          required: true,
          minimum: -90,
          maximum: 90,
        }),
        lon: numberField(item, "lon", {
          required: true,
          minimum: -180,
          maximum: 180,
        }),
        altitude: numberField(item, "altitude", {
          nullable: true,
          minimum: -20_000,
          maximum: 100_000,
        }),
        accuracy: numberField(item, "accuracy", {
          nullable: true,
          minimum: 0,
          maximum: 1_000_000,
        }),
        speed: numberField(item, "speed", {
          nullable: true,
          minimum: 0,
          maximum: 10_000,
        }),
        bearing: numberField(item, "bearing", {
          nullable: true,
          minimum: 0,
          maximum: 360,
        }),
        recordedAt: dateTimeField(item, "recordedAt", {
          required: true,
        }),
        inputIndex: index,
      };
    });

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const trip = await getOwnedTrip(client, request.auth.userId, tripId, {
        includeTags: false,
      });

      if (!trip) {
        throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
      }

      if (trip.status !== "recording") {
        throw conflict(
          "TRIP_NOT_RECORDING",
          "Für diese Fahrt ist die Aufzeichnung bereits beendet.",
        );
      }

      const payload = points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        altitude_meters: point.altitude,
        accuracy_meters: point.accuracy,
        speed_mps: point.speed,
        bearing_degrees: point.bearing === 360 ? 0 : point.bearing,
        recorded_at: point.recordedAt.toISOString(),
        input_index: point.inputIndex,
      }));

      const insertResult = await client.query(
        `
          WITH current_sequence AS (
            SELECT COALESCE(max(sequence_number), -1) AS maximum
            FROM track_points
            WHERE trip_id = $1
          ),
          input AS (
            SELECT *
            FROM jsonb_to_recordset($2::jsonb) AS point (
              lat double precision,
              lon double precision,
              altitude_meters double precision,
              accuracy_meters double precision,
              speed_mps double precision,
              bearing_degrees double precision,
              recorded_at timestamptz,
              input_index integer
            )
          )
          INSERT INTO track_points (
            trip_id,
            sequence_number,
            lat,
            lon,
            altitude_meters,
            accuracy_meters,
            speed_mps,
            bearing_degrees,
            recorded_at
          )
          SELECT
            $1,
            current_sequence.maximum + row_number() OVER (ORDER BY input_index),
            lat,
            lon,
            altitude_meters,
            accuracy_meters,
            speed_mps,
            bearing_degrees,
            recorded_at
          FROM input
          CROSS JOIN current_sequence
          ORDER BY input_index
          RETURNING id
        `,
        [tripId, JSON.stringify(payload)],
      );

      await recalculateTripMetrics(client, tripId);
      await client.query("COMMIT");

      response.status(202).json({
        accepted: insertResult.rowCount,
        tripId,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

trackingRoutes.post(
  "/stop",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);
    const tripId = uuidField(body, "tripId", true);
    const endedAt =
      dateTimeField(body, "endedAt", { nullable: true }) || new Date();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const trip = await getOwnedTrip(client, request.auth.userId, tripId, {
        includeTags: false,
      });

      if (!trip) {
        throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
      }

      if (trip.status !== "recording") {
        throw conflict(
          "TRIP_NOT_RECORDING",
          "Die Fahrt wird nicht mehr aufgezeichnet.",
        );
      }

      if (endedAt < new Date(trip.started_at)) {
        throw badRequest(
          "VALIDATION_ERROR",
          "Das Enddatum darf nicht vor dem Startdatum liegen.",
        );
      }

      await recalculateTripMetrics(client, tripId);

      const result = await client.query(
        `
          UPDATE trips
          SET
            status = 'completed',
            ended_at = $3,
            duration_seconds = COALESCE(
              duration_seconds,
              GREATEST(0, extract(epoch FROM ($3 - started_at))::integer)
            ),
            completed_at = now(),
            version = version + 1
          WHERE id = $1
            AND user_id = $2
          RETURNING *
        `,
        [tripId, request.auth.userId, endedAt],
      );

      await client.query("COMMIT");
      response.json(mapTrip(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

trackingRoutes.get(
  "/status",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
        SELECT *
        FROM trips
        WHERE user_id = $1
          AND status = 'recording'
          AND archived_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1
      `,
      [request.auth.userId],
    );

    response.json({
      active: result.rowCount > 0,
      trip: result.rows[0] ? mapTrip(result.rows[0]) : null,
    });
  }),
);
