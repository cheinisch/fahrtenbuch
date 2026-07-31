import { Router } from "express";

import { pool } from "../database/pool.js";
import {
  badRequest,
  notFound,
} from "../lib/errors.js";
import {
  mapTrackPoint,
  mapTrip,
} from "../lib/mappers.js";
import {
  arrayField,
  dateTimeField,
  numberField,
  enumField,
  objectBody,
  queryInteger,
  stringField,
  uuidField,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  ensureOwnedVehicle,
  getOwnedTrip,
  TRIP_WITH_TAGS_SELECT,
} from "../services/tripService.js";

export const tripRoutes = Router();

tripRoutes.use(requireAuth);

const TRIP_TYPES = [
  "business",
  "private",
  "commute",
  "unclassified",
];

function parseTripInput(body) {
  const input = objectBody(body);
  const startedAt = dateTimeField(input, "startedAt", {
    required: true,
  });
  const endedAt = dateTimeField(input, "endedAt", {
    nullable: true,
  });

  if (endedAt && endedAt < startedAt) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Das Enddatum darf nicht vor dem Startdatum liegen.",
    );
  }

  const startOdometerKm = numberField(input, "startOdometerKm", {
    nullable: true,
    minimum: 0,
    maximum: 1_000_000_000,
  });
  const endOdometerKm = numberField(input, "endOdometerKm", {
    nullable: true,
    minimum: 0,
    maximum: 1_000_000_000,
  });

  if (
    startOdometerKm != null &&
    endOdometerKm != null &&
    endOdometerKm < startOdometerKm
  ) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Der Endkilometerstand darf nicht kleiner als der Startkilometerstand sein.",
    );
  }

  return {
    vehicleId: uuidField(input, "vehicleId", true),
    type:
      enumField(input, "type", TRIP_TYPES) ||
      "unclassified",
    startedAt,
    endedAt: endedAt ?? null,
    startAddress: stringField(input, "startAddress", {
      nullable: true,
      maximum: 1000,
    }),
    endAddress: stringField(input, "endAddress", {
      nullable: true,
      maximum: 1000,
    }),
    purpose: stringField(input, "purpose", {
      nullable: true,
      maximum: 1000,
    }),
    contact: stringField(input, "contact", {
      nullable: true,
      maximum: 1000,
    }),
    notes: stringField(input, "notes", {
      nullable: true,
      maximum: 20_000,
    }),
    startOdometerMeters:
      startOdometerKm == null
        ? null
        : Math.round(startOdometerKm * 1000),
    endOdometerMeters:
      endOdometerKm == null
        ? null
        : Math.round(endOdometerKm * 1000),
  };
}

tripRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const parameters = [request.auth.userId];
    const conditions = [
      "t.user_id = $1",
      "t.archived_at IS NULL",
    ];

    if (request.query.vehicleId) {
      parameters.push(uuidValue(String(request.query.vehicleId), "vehicleId"));
      conditions.push(`t.vehicle_id = $${parameters.length}`);
    }

    if (request.query.type) {
      const type = String(request.query.type);

      if (!TRIP_TYPES.includes(type)) {
        throw badRequest("VALIDATION_ERROR", "Der Fahrttyp ist ungültig.");
      }

      parameters.push(type);
      conditions.push(`t.type = $${parameters.length}::trip_type`);
    }

    if (request.query.from) {
      const from = new Date(String(request.query.from));

      if (Number.isNaN(from.getTime())) {
        throw badRequest("VALIDATION_ERROR", "Der Parameter „from“ ist ungültig.");
      }

      parameters.push(from);
      conditions.push(`t.started_at >= $${parameters.length}`);
    }

    if (request.query.to) {
      const to = new Date(String(request.query.to));

      if (Number.isNaN(to.getTime())) {
        throw badRequest("VALIDATION_ERROR", "Der Parameter „to“ ist ungültig.");
      }

      parameters.push(to);
      conditions.push(`t.started_at <= $${parameters.length}`);
    }

    const limit = queryInteger(request.query.limit, "limit", {
      fallback: 100,
      minimum: 1,
      maximum: 500,
    });
    const offset = queryInteger(request.query.offset, "offset", {
      fallback: 0,
      minimum: 0,
      maximum: 10_000_000,
    });

    parameters.push(limit);
    const limitParameter = `$${parameters.length}`;
    parameters.push(offset);
    const offsetParameter = `$${parameters.length}`;

    const result = await pool.query(
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
        WHERE ${conditions.join(" AND ")}
        GROUP BY t.id, v.id
        ORDER BY t.started_at DESC, t.id DESC
        LIMIT ${limitParameter}
        OFFSET ${offsetParameter}
      `,
      parameters,
    );

    response.json(result.rows.map(mapTrip));
  }),
);

tripRoutes.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = parseTripInput(request.body);

    if (!(await ensureOwnedVehicle(pool, request.auth.userId, input.vehicleId))) {
      throw badRequest(
        "VEHICLE_NOT_FOUND",
        "Das Fahrzeug wurde nicht gefunden.",
      );
    }

    const status = input.endedAt ? "completed" : "recording";
    const durationSeconds = input.endedAt
      ? Math.max(
          0,
          Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 1000),
        )
      : null;

    const result = await pool.query(
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
          start_odometer_meters,
          end_odometer_meters,
          duration_seconds,
          source,
          completed_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, 'manual',
          CASE WHEN $4 = 'completed' THEN now() ELSE NULL END
        )
        RETURNING *
      `,
      [
        request.auth.userId,
        input.vehicleId,
        input.type,
        status,
        input.startedAt,
        input.endedAt,
        input.startAddress,
        input.endAddress,
        input.purpose,
        input.contact,
        input.notes,
        input.startOdometerMeters,
        input.endOdometerMeters,
        durationSeconds,
      ],
    );

    response.status(201).json(mapTrip(result.rows[0]));
  }),
);

tripRoutes.get(
  "/:id/points",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const trip = await getOwnedTrip(pool, request.auth.userId, tripId, {
      includeTags: false,
    });

    if (!trip) {
      throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
    }

    const result = await pool.query(
      `
        SELECT *
        FROM track_points
        WHERE trip_id = $1
        ORDER BY sequence_number, recorded_at, id
      `,
      [tripId],
    );

    response.json(result.rows.map(mapTrackPoint));
  }),
);

tripRoutes.put(
  "/:id/classify",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const body = objectBody(request.body);
    const type = enumField(
      body,
      "type",
      ["business", "private", "commute"],
      { required: true },
    );
    const purpose = stringField(body, "purpose", {
      nullable: true,
      maximum: 1000,
    });
    const contact = stringField(body, "contact", {
      nullable: true,
      maximum: 1000,
    });

    const result = await pool.query(
      `
        UPDATE trips
        SET
          type = $3,
          purpose = $4,
          contact = $5,
          version = version + 1
        WHERE id = $1
          AND user_id = $2
          AND archived_at IS NULL
        RETURNING *
      `,
      [tripId, request.auth.userId, type, purpose, contact],
    );

    if (result.rowCount === 0) {
      throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
    }

    response.json(mapTrip(result.rows[0]));
  }),
);

tripRoutes.put(
  "/:id/tags",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const body = objectBody(request.body);
    const tagIds = arrayField(body, "tagIds", {
      required: true,
      maximum: 100,
    }).map((tagId) => uuidValue(String(tagId), "tagId"));
    const uniqueTagIds = [...new Set(tagIds)];

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const trip = await getOwnedTrip(client, request.auth.userId, tripId, {
        includeTags: false,
      });

      if (!trip) {
        throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
      }

      if (uniqueTagIds.length > 0) {
        const tagsResult = await client.query(
          `
            SELECT id
            FROM tags
            WHERE user_id = $1
              AND id = ANY($2::uuid[])
          `,
          [request.auth.userId, uniqueTagIds],
        );

        if (tagsResult.rowCount !== uniqueTagIds.length) {
          throw badRequest(
            "TAG_NOT_FOUND",
            "Mindestens ein Tag wurde nicht gefunden.",
          );
        }
      }

      await client.query(`DELETE FROM trip_tags WHERE trip_id = $1`, [tripId]);

      if (uniqueTagIds.length > 0) {
        await client.query(
          `
            INSERT INTO trip_tags (user_id, trip_id, tag_id)
            SELECT $1, $2, unnest($3::uuid[])
          `,
          [request.auth.userId, tripId, uniqueTagIds],
        );
      }

      const updated = await getOwnedTrip(client, request.auth.userId, tripId);
      await client.query("COMMIT");
      response.json(mapTrip(updated));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

tripRoutes.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const trip = await getOwnedTrip(pool, request.auth.userId, tripId);

    if (!trip) {
      throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
    }

    response.json(mapTrip(trip));
  }),
);

tripRoutes.put(
  "/:id",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const input = parseTripInput(request.body);

    if (!(await ensureOwnedVehicle(pool, request.auth.userId, input.vehicleId))) {
      throw badRequest(
        "VEHICLE_NOT_FOUND",
        "Das Fahrzeug wurde nicht gefunden.",
      );
    }

    const status = input.endedAt ? "completed" : "recording";
    const durationSeconds = input.endedAt
      ? Math.max(
          0,
          Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 1000),
        )
      : null;

    const result = await pool.query(
      `
        UPDATE trips
        SET
          vehicle_id = $3,
          type = $4,
          status = $5,
          started_at = $6,
          ended_at = $7,
          start_address = $8,
          end_address = $9,
          purpose = $10,
          contact = $11,
          notes = $12,
          start_odometer_meters = $13,
          end_odometer_meters = $14,
          duration_seconds = COALESCE(duration_seconds, $15),
          completed_at = CASE
            WHEN $5 = 'completed' THEN COALESCE(completed_at, now())
            ELSE NULL
          END,
          version = version + 1
        WHERE id = $1
          AND user_id = $2
          AND archived_at IS NULL
        RETURNING *
      `,
      [
        tripId,
        request.auth.userId,
        input.vehicleId,
        input.type,
        status,
        input.startedAt,
        input.endedAt,
        input.startAddress,
        input.endAddress,
        input.purpose,
        input.contact,
        input.notes,
        input.startOdometerMeters,
        input.endOdometerMeters,
        durationSeconds,
      ],
    );

    if (result.rowCount === 0) {
      throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
    }

    response.json(mapTrip(result.rows[0]));
  }),
);

tripRoutes.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const result = await pool.query(
      `
        UPDATE trips
        SET archived_at = now(), version = version + 1
        WHERE id = $1
          AND user_id = $2
          AND archived_at IS NULL
        RETURNING id
      `,
      [tripId, request.auth.userId],
    );

    if (result.rowCount === 0) {
      throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
    }

    response.status(204).end();
  }),
);
