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
  appendTripHistory,
  ensureOwnedVehicle,
  getOwnedTrip,
  recalculateTripMetrics,
  replaceTripTags,
  TRIP_WITH_TAGS_SELECT,
} from "../services/tripService.js";
import { getLocationSuggestions } from "../services/tripSuggestionService.js";

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


tripRoutes.post(
  "/:id/split",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const splitPointId = uuidValue(request.body?.pointId, "pointId");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const trip = await getOwnedTrip(client, request.auth.userId, tripId);
      if (!trip) throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
      if (trip.status !== "completed") {
        throw badRequest("TRIP_NOT_COMPLETED", "Nur abgeschlossene Fahrten können geteilt werden.");
      }

      const pointsResult = await client.query(
        `SELECT * FROM track_points WHERE trip_id = $1
         ORDER BY sequence_number, recorded_at, id FOR UPDATE`,
        [tripId],
      );
      const splitIndex = pointsResult.rows.findIndex((point) => point.id === splitPointId);
      if (splitIndex <= 0 || splitIndex >= pointsResult.rows.length - 1) {
        throw badRequest("INVALID_SPLIT_POINT", "Zum Teilen muss ein innerer GPS-Punkt gewählt werden.");
      }

      const points = pointsResult.rows;
      const secondPoints = points.slice(splitIndex);
      const splitAt = new Date(points[splitIndex].recorded_at);
      const originalEnd = trip.ended_at;

      const created = await client.query(
        `INSERT INTO trips (
           user_id, vehicle_id, type, status, started_at, ended_at,
           start_lat, start_lon, end_lat, end_lon, start_address, end_address,
           purpose, contact, notes, source, completed_at
         )
         VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,$14,now())
         RETURNING id`,
        [
          request.auth.userId, trip.vehicle_id, trip.type, splitAt, originalEnd,
          Number(points[splitIndex].lat), Number(points[splitIndex].lon),
          trip.end_lat, trip.end_lon, trip.end_address, trip.purpose, trip.contact,
          trip.notes, trip.source,
        ],
      );
      const secondId = created.rows[0].id;

      await client.query(
        `UPDATE trips SET ended_at=$3, end_lat=$4, end_lon=$5, end_address=NULL,
          version=version+1, completed_at=now()
         WHERE id=$1 AND user_id=$2`,
        [tripId, request.auth.userId, splitAt, Number(points[splitIndex].lat), Number(points[splitIndex].lon)],
      );

      await client.query(
        `UPDATE track_points SET trip_id=$1, sequence_number=m.new_sequence
         FROM (
           SELECT id, row_number() OVER (ORDER BY sequence_number, recorded_at, id) - 1 AS new_sequence
           FROM track_points WHERE id = ANY($2::uuid[])
         ) m
         WHERE track_points.id=m.id`,
        [secondId, secondPoints.map((point) => point.id)],
      );

      const tagResult = await client.query(
        `SELECT tag_id FROM trip_tags WHERE trip_id=$1 AND user_id=$2`,
        [tripId, request.auth.userId],
      );
      await replaceTripTags(client, request.auth.userId, secondId, tagResult.rows.map((row) => row.tag_id));

      await recalculateTripMetrics(client, tripId);
      await recalculateTripMetrics(client, secondId);

      await appendTripHistory(client, {
        tripId, userId: request.auth.userId, eventType: "TRIP_SPLIT",
        metadata: { splitAt: splitAt.toISOString(), splitPointId, resultingTripIds: [tripId, secondId] },
      });
      await appendTripHistory(client, {
        tripId: secondId, userId: request.auth.userId, eventType: "TRIP_SPLIT",
        metadata: { splitAt: splitAt.toISOString(), splitPointId, sourceTripId: tripId, resultingTripIds: [tripId, secondId] },
      });

      const first = await getOwnedTrip(client, request.auth.userId, tripId);
      const second = await getOwnedTrip(client, request.auth.userId, secondId);
      await client.query("COMMIT");
      response.json({ trips: [mapTrip(first), mapTrip(second)] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

tripRoutes.post(
  "/merge",
  asyncHandler(async (request, response) => {
    const rawIds = Array.isArray(request.body?.tripIds) ? request.body.tripIds : [];
    const tripIds = [...new Set(rawIds.map((id) => uuidValue(String(id), "tripId")))];
    if (tripIds.length < 2 || tripIds.length > 20) {
      throw badRequest("VALIDATION_ERROR", "Zum Zusammenführen müssen 2 bis 20 Fahrten gewählt werden.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tripsResult = await client.query(
        `SELECT * FROM trips WHERE user_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL
         ORDER BY started_at, id FOR UPDATE`,
        [request.auth.userId, tripIds],
      );
      if (tripsResult.rowCount !== tripIds.length) {
        throw notFound("TRIP_NOT_FOUND", "Mindestens eine Fahrt wurde nicht gefunden.");
      }
      const trips = tripsResult.rows;
      if (trips.some((trip) => trip.status !== "completed")) {
        throw badRequest("TRIP_NOT_COMPLETED", "Nur abgeschlossene Fahrten können zusammengeführt werden.");
      }
      if (new Set(trips.map((trip) => trip.vehicle_id)).size !== 1) {
        throw badRequest("VEHICLE_MISMATCH", "Es können nur Fahrten desselben Fahrzeugs zusammengeführt werden.");
      }

      const target = trips[0];
      const sourceIds = trips.slice(1).map((trip) => trip.id);
      const last = trips[trips.length - 1];

      await client.query(
        `UPDATE track_points SET trip_id=$1 WHERE trip_id=ANY($2::uuid[])`,
        [target.id, sourceIds],
      );
      await client.query(
        `WITH ordered AS (
           SELECT id, row_number() OVER (ORDER BY recorded_at, sequence_number, id)-1 AS seq
           FROM track_points WHERE trip_id=$1
         )
         UPDATE track_points SET sequence_number=ordered.seq
         FROM ordered WHERE track_points.id=ordered.id`,
        [target.id],
      );

      await client.query(
        `INSERT INTO trip_tags(user_id,trip_id,tag_id)
         SELECT $1,$2,tag_id FROM trip_tags WHERE trip_id=ANY($3::uuid[])
         ON CONFLICT (trip_id,tag_id) DO NOTHING`,
        [request.auth.userId, target.id, tripIds],
      );

      await client.query(
        `UPDATE trips SET ended_at=$3, end_lat=$4, end_lon=$5, end_address=$6,
          type=CASE WHEN NOT EXISTS (
            SELECT 1 FROM trips x WHERE x.id=ANY($7::uuid[]) AND x.type<>$8::trip_type
          ) THEN $8::trip_type ELSE 'unclassified'::trip_type END,
          purpose=CASE WHEN NOT EXISTS (
            SELECT 1 FROM trips x WHERE x.id=ANY($7::uuid[]) AND x.purpose IS DISTINCT FROM $9
          ) THEN $9 ELSE NULL END,
          contact=CASE WHEN NOT EXISTS (
            SELECT 1 FROM trips x WHERE x.id=ANY($7::uuid[]) AND x.contact IS DISTINCT FROM $10
          ) THEN $10 ELSE NULL END,
          version=version+1, completed_at=now()
         WHERE id=$1 AND user_id=$2`,
        [target.id, request.auth.userId, last.ended_at, last.end_lat, last.end_lon, last.end_address,
         tripIds, target.type, target.purpose, target.contact],
      );

      await client.query(
        `UPDATE trips SET archived_at=now(), version=version+1 WHERE user_id=$1 AND id=ANY($2::uuid[])`,
        [request.auth.userId, sourceIds],
      );
      await recalculateTripMetrics(client, target.id);

      await appendTripHistory(client, {
        tripId: target.id, userId: request.auth.userId, eventType: "TRIP_MERGED",
        metadata: { sourceTripIds: tripIds, resultingTripId: target.id },
      });
      for (const sourceId of sourceIds) {
        await appendTripHistory(client, {
          tripId: sourceId, userId: request.auth.userId, eventType: "TRIP_MERGED",
          metadata: { sourceTripIds: tripIds, resultingTripId: target.id },
        });
      }

      const merged = await getOwnedTrip(client, request.auth.userId, target.id);
      await client.query("COMMIT");
      response.json({ trip: mapTrip(merged), sourceTripIds: tripIds });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

tripRoutes.get(
  "/:id/suggestions",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const trip = await getOwnedTrip(pool, request.auth.userId, tripId, { includeTags: false });
    if (!trip) throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
    response.json({ suggestions: await getLocationSuggestions(request.auth.userId, trip) });
  }),
);

tripRoutes.post(
  "/:id/route-correction",
  asyncHandler(async (request, response) => {
    const tripId = uuidValue(request.params.id);
    const points = Array.isArray(request.body?.points) ? request.body.points : [];
    if (points.length < 2 || points.length > 10000) {
      throw badRequest("VALIDATION_ERROR", "Die korrigierte Route muss 2 bis 10000 Punkte enthalten.");
    }
    const normalized = points.map((point, index) => {
      const lat=Number(point.latitude), lon=Number(point.longitude);
      if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180)
        throw badRequest("VALIDATION_ERROR", `Routenpunkt ${index + 1} ist ungültig.`);
      return {lat,lon};
    });
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const trip=await getOwnedTrip(client,request.auth.userId,tripId,{includeTags:false});
      if(!trip) throw notFound("TRIP_NOT_FOUND","Die Fahrt wurde nicht gefunden.");
      if(trip.status!=="completed") throw badRequest("TRIP_NOT_COMPLETED","Nur abgeschlossene Fahrten können korrigiert werden.");
      const times=await client.query(`SELECT min(recorded_at) AS first_at,max(recorded_at) AS last_at FROM track_points WHERE trip_id=$1`,[tripId]);
      const firstAt=new Date(times.rows[0]?.first_at || trip.started_at);
      const lastAt=new Date(times.rows[0]?.last_at || trip.ended_at);
      await client.query(`DELETE FROM track_points WHERE trip_id=$1`,[tripId]);
      for(let i=0;i<normalized.length;i++){
        const ratio=normalized.length===1?0:i/(normalized.length-1);
        const at=new Date(firstAt.getTime()+(lastAt.getTime()-firstAt.getTime())*ratio);
        await client.query(`INSERT INTO track_points(trip_id,sequence_number,lat,lon,recorded_at)
          VALUES($1,$2,$3,$4,$5)`,[tripId,i,normalized[i].lat,normalized[i].lon,at]);
      }
      await recalculateTripMetrics(client,tripId);
      await appendTripHistory(client,{tripId,userId:request.auth.userId,eventType:"ROUTE_CORRECTED",
        metadata:{pointCount:normalized.length,method:"manual-map"}});
      const updated=await getOwnedTrip(client,request.auth.userId,tripId);
      await client.query("COMMIT");
      response.json(mapTrip(updated));
    } catch(error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
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
          h.previous_hash,
          h.entry_hash,
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
        previousHash: row.previous_hash ?? null,
        entryHash: row.entry_hash ?? null,
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
