import { routeDistance } from "../lib/geo.js";
import { mapTrip } from "../lib/mappers.js";

export const TRIP_SELECT = `
  t.id,
  t.user_id,
  t.vehicle_id,
  t.type,
  t.status,
  t.started_at,
  t.ended_at,
  t.start_lat,
  t.start_lon,
  t.end_lat,
  t.end_lon,
  t.start_address,
  t.end_address,
  t.purpose,
  t.contact,
  t.notes,
  t.distance_meters,
  t.duration_seconds,
  t.source,
  t.version,
  t.completed_at,
  t.cancelled_at,
  t.archived_at,
  t.created_at,
  t.updated_at
`;

export const TRIP_WITH_TAGS_SELECT = `
  ${TRIP_SELECT},
  v.name AS vehicle_name,
  v.manufacturer AS vehicle_manufacturer,
  v.model AS vehicle_model,
  v.license_plate AS vehicle_license_plate,
  v.color AS vehicle_color,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'id', tag.id,
        'name', tag.name,
        'color', tag.color
      )
    ) FILTER (WHERE tag.id IS NOT NULL),
    '[]'::jsonb
  ) AS tags
`;

export async function getOwnedTrip(
  client,
  userId,
  tripId,
  { includeArchived = false, includeTags = true } = {},
) {
  const result = await client.query(
    includeTags
      ? `
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
          WHERE t.id = $1
            AND t.user_id = $2
            ${includeArchived ? "" : "AND t.archived_at IS NULL"}
          GROUP BY t.id, v.id
          LIMIT 1
        `
      : `
          SELECT ${TRIP_SELECT}
          FROM trips t
          WHERE t.id = $1
            AND t.user_id = $2
            ${includeArchived ? "" : "AND t.archived_at IS NULL"}
          LIMIT 1
        `,
    [tripId, userId],
  );

  return result.rows[0] || null;
}

export async function recalculateTripMetrics(client, tripId) {
  const pointsResult = await client.query(
    `
      SELECT lat, lon, recorded_at
      FROM track_points
      WHERE trip_id = $1
      ORDER BY sequence_number, recorded_at, id
    `,
    [tripId],
  );

  const points = pointsResult.rows.map((point) => ({
    ...point,
    lat: Number(point.lat),
    lon: Number(point.lon),
  }));

  if (points.length === 0) {
    return null;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const distanceMeters = routeDistance(points);
  const durationSeconds = Math.max(
    0,
    Math.round(
      (new Date(last.recorded_at).getTime() -
        new Date(first.recorded_at).getTime()) /
        1000,
    ),
  );

  const result = await client.query(
    `
      UPDATE trips
      SET
        start_lat = $2,
        start_lon = $3,
        end_lat = $4,
        end_lon = $5,
        distance_meters = $6,
        duration_seconds = $7
      WHERE id = $1
      RETURNING *
    `,
    [
      tripId,
      first.lat,
      first.lon,
      last.lat,
      last.lon,
      distanceMeters,
      durationSeconds,
    ],
  );

  return result.rows[0] ? mapTrip(result.rows[0]) : null;
}

export async function ensureOwnedVehicle(client, userId, vehicleId) {
  const result = await client.query(
    `
      SELECT id
      FROM vehicles
      WHERE id = $1
        AND user_id = $2
        AND archived_at IS NULL
      LIMIT 1
    `,
    [vehicleId, userId],
  );

  return result.rowCount > 0;
}


export async function replaceTripTags(
  client,
  userId,
  tripId,
  tagIds = [],
) {
  const uniqueTagIds = [
    ...new Set(
      (tagIds || []).map(String),
    ),
  ];

  if (uniqueTagIds.length > 100) {
    throw new Error(
      "Eine Fahrt darf höchstens 100 Tags besitzen.",
    );
  }

  if (uniqueTagIds.length > 0) {
    const tagsResult = await client.query(
      `
        SELECT id
        FROM tags
        WHERE user_id = $1
          AND id = ANY($2::uuid[])
      `,
      [userId, uniqueTagIds],
    );

    if (
      tagsResult.rowCount !==
      uniqueTagIds.length
    ) {
      const error = new Error(
        "Mindestens ein Tag wurde nicht gefunden oder gehört einem anderen Benutzer.",
      );
      error.code = "TAG_NOT_FOUND";
      throw error;
    }
  }

  await client.query(
    `
      DELETE FROM trip_tags
      WHERE trip_id = $1
        AND user_id = $2
        AND NOT (tag_id = ANY($3::uuid[]))
    `,
    [userId, tripId, uniqueTagIds],
  );

  if (uniqueTagIds.length > 0) {
    await client.query(
      `
        INSERT INTO trip_tags (
          user_id,
          trip_id,
          tag_id
        )
        SELECT
          $1,
          $2,
          tag_id
        FROM unnest($3::uuid[]) AS requested(tag_id)
        ON CONFLICT (trip_id, tag_id) DO NOTHING
      `,
      [userId, tripId, uniqueTagIds],
    );
  }
}

export async function appendTripHistory(
  client,
  {
    tripId,
    userId,
    actorUserId = userId,
    eventType,
    changedFields = {},
    oldValues = null,
    newValues = null,
    metadata = {},
  },
) {
  await client.query(
    `
      INSERT INTO trip_history (
        trip_id,
        user_id,
        actor_user_id,
        event_type,
        changed_fields,
        old_values,
        new_values,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
    `,
    [
      tripId,
      userId,
      actorUserId,
      eventType,
      JSON.stringify(changedFields || {}),
      oldValues === null ? null : JSON.stringify(oldValues),
      newValues === null ? null : JSON.stringify(newValues),
      JSON.stringify(metadata || {}),
    ],
  );
}

