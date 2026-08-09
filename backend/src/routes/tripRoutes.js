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
  replaceTripTags,
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

function parseTagIds(input) {
  const values = arrayField(
    input,
    "tagIds",
    {
      maximum: 100,
    },
  );

  if (values === undefined) {
    return undefined;
  }

  return [
    ...new Set(
      values.map((tagId) =>
        uuidValue(
          String(tagId),
          "tagId",
        ),
      ),
    ),
  ];
}

function parseTripInput(body) {
  const input = objectBody(body);
  const startedAt = dateTimeField(
    input,
    "startedAt",
    {
      required: true,
    },
  );
  const endedAt = dateTimeField(
    input,
    "endedAt",
    {
      nullable: true,
    },
  );

  if (endedAt && endedAt < startedAt) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Das Enddatum darf nicht vor dem Startdatum liegen.",
    );
  }

  const category =
    input.category !== undefined
      ? enumField(
          input,
          "category",
          TRIP_TYPES,
          { required: true },
        )
      : enumField(
          input,
          "type",
          TRIP_TYPES,
        ) || "unclassified";

  return {
    vehicleId: uuidField(
      input,
      "vehicleId",
      true,
    ),
    category,
    tagIds: parseTagIds(input),
    startedAt,
    endedAt: endedAt ?? null,
    startAddress: stringField(
      input,
      "startAddress",
      {
        nullable: true,
        maximum: 1000,
      },
    ),
    endAddress: stringField(
      input,
      "endAddress",
      {
        nullable: true,
        maximum: 1000,
      },
    ),
    purpose: stringField(
      input,
      "purpose",
      {
        nullable: true,
        maximum: 1000,
      },
    ),
    contact: stringField(
      input,
      "contact",
      {
        nullable: true,
        maximum: 1000,
      },
    ),
    notes: stringField(
      input,
      "notes",
      {
        nullable: true,
        maximum: 20_000,
      },
    ),
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
    const input = parseTripInput(
      request.body,
    );

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (
        !(await ensureOwnedVehicle(
          client,
          request.auth.userId,
          input.vehicleId,
        ))
      ) {
        throw badRequest(
          "VEHICLE_NOT_FOUND",
          "Das Fahrzeug wurde nicht gefunden.",
        );
      }

      const status = input.endedAt
        ? "completed"
        : "recording";

      const durationSeconds = input.endedAt
        ? Math.max(
            0,
            Math.round(
              (input.endedAt.getTime() -
                input.startedAt.getTime()) /
                1000,
            ),
          )
        : null;

      const result = await client.query(
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
            duration_seconds,
            source,
            completed_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            'manual',
            CASE
              WHEN $4 = 'completed'
                THEN now()
              ELSE NULL
            END
          )
          RETURNING id
        `,
        [
          request.auth.userId,
          input.vehicleId,
          input.category,
          status,
          input.startedAt,
          input.endedAt,
          input.startAddress,
          input.endAddress,
          input.purpose,
          input.contact,
          input.notes,
          durationSeconds,
        ],
      );

      await replaceTripTags(
        client,
        request.auth.userId,
        result.rows[0].id,
        input.tagIds || [],
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

tripRoutes.get(
  "/:id/history",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const trip = await getOwnedTrip(
      pool,
      request.auth.userId,
      tripId,
      { includeArchived: true, includeTags: false },
    );

    if (!trip) {
      throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
    }

    const result = await pool.query(
      `
        SELECT
          h.id,
          h.trip_id,
          h.user_id,
          h.actor_user_id,
          h.event_type,
          h.changed_fields,
          h.old_values,
          h.new_values,
          h.metadata,
          h.created_at,
          u.display_name AS actor_display_name,
          u.username AS actor_username,
          u.email AS actor_email
        FROM trip_history h
        LEFT JOIN users u
          ON u.id = h.actor_user_id
        WHERE h.trip_id = $1
          AND h.user_id = $2
        ORDER BY h.created_at ASC, h.id ASC
      `,
      [tripId, request.auth.userId],
    );

    response.json(
      result.rows.map((row) => ({
        id: String(row.id),
        tripId: row.trip_id,
        eventType: row.event_type,
        changedFields: row.changed_fields || {},
        oldValues: row.old_values ?? null,
        newValues: row.new_values ?? null,
        metadata: row.metadata || {},
        actor: row.actor_user_id
          ? {
              id: row.actor_user_id,
              displayName: row.actor_display_name ?? null,
              username: row.actor_username ?? null,
              email: row.actor_email ?? null,
            }
          : null,
        createdAt: row.created_at,
      })),
    );
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
    const tripId = uuidValue(
      request.params.id,
    );
    const body = objectBody(
      request.body,
    );

    const category =
      body.category !== undefined
        ? enumField(
            body,
            "category",
            [
              "business",
              "private",
              "commute",
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
            ],
            { required: true },
          );

    const purpose = stringField(
      body,
      "purpose",
      {
        nullable: true,
        maximum: 1000,
      },
    );
    const contact = stringField(
      body,
      "contact",
      {
        nullable: true,
        maximum: 1000,
      },
    );

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
        RETURNING id
      `,
      [
        tripId,
        request.auth.userId,
        category,
        purpose,
        contact,
      ],
    );

    if (result.rowCount === 0) {
      throw notFound(
        "TRIP_NOT_FOUND",
        "Die Fahrt wurde nicht gefunden.",
      );
    }

    const trip = await getOwnedTrip(
      pool,
      request.auth.userId,
      tripId,
    );

    response.json(mapTrip(trip));
  }),
);

tripRoutes.put(
  "/:id/tags",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(
      request.params.id,
    );
    const body = objectBody(
      request.body,
    );
    const tagIds =
      parseTagIds(body) || [];

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const trip = await getOwnedTrip(
        client,
        request.auth.userId,
        tripId,
        { includeTags: false },
      );

      if (!trip) {
        throw notFound(
          "TRIP_NOT_FOUND",
          "Die Fahrt wurde nicht gefunden.",
        );
      }

      await replaceTripTags(
        client,
        request.auth.userId,
        tripId,
        tagIds,
      );

      const updated = await getOwnedTrip(
        client,
        request.auth.userId,
        tripId,
      );

      await client.query("COMMIT");
      response.json(mapTrip(updated));
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
    const tripId = uuidValue(
      request.params.id,
    );
    const input = parseTripInput(
      request.body,
    );

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (
        !(await ensureOwnedVehicle(
          client,
          request.auth.userId,
          input.vehicleId,
        ))
      ) {
        throw badRequest(
          "VEHICLE_NOT_FOUND",
          "Das Fahrzeug wurde nicht gefunden.",
        );
      }

      const status = input.endedAt
        ? "completed"
        : "recording";

      const durationSeconds = input.endedAt
        ? Math.max(
            0,
            Math.round(
              (input.endedAt.getTime() -
                input.startedAt.getTime()) /
                1000,
            ),
          )
        : null;

      const result = await client.query(
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
            duration_seconds =
              COALESCE(
                duration_seconds,
                $13
              ),
            completed_at = CASE
              WHEN $5 = 'completed'
                THEN COALESCE(
                  completed_at,
                  now()
                )
              ELSE NULL
            END,
            version = version + 1
          WHERE id = $1
            AND user_id = $2
            AND archived_at IS NULL
          RETURNING id
        `,
        [
          tripId,
          request.auth.userId,
          input.vehicleId,
          input.category,
          status,
          input.startedAt,
          input.endedAt,
          input.startAddress,
          input.endAddress,
          input.purpose,
          input.contact,
          input.notes,
          durationSeconds,
        ],
      );

      if (result.rowCount === 0) {
        throw notFound(
          "TRIP_NOT_FOUND",
          "Die Fahrt wurde nicht gefunden.",
        );
      }

      if (input.tagIds !== undefined) {
        await replaceTripTags(
          client,
          request.auth.userId,
          tripId,
          input.tagIds,
        );
      }

      const trip = await getOwnedTrip(
        client,
        request.auth.userId,
        tripId,
      );

      await client.query("COMMIT");
      response.json(mapTrip(trip));
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
