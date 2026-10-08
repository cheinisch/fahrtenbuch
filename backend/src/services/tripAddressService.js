import { pool } from "../database/pool.js";
import { photonReverse } from "./geocodingService.js";

/**
 * Resolve the first and last GPS fixes of a trip without overwriting
 * addresses already entered manually. Photon outages must not affect trips.
 */
export async function resolveTripEndpointAddresses(tripId, userId) {
  const result = await pool.query(
    `SELECT t.start_address, t.end_address,
       (SELECT row_to_json(p) FROM (
          SELECT lat, lon FROM track_points WHERE trip_id=t.id
          ORDER BY recorded_at ASC, sequence_number ASC LIMIT 1
        ) p) AS first_point,
       (SELECT row_to_json(p) FROM (
          SELECT lat, lon FROM track_points WHERE trip_id=t.id
          ORDER BY recorded_at DESC, sequence_number DESC LIMIT 1
        ) p) AS last_point
     FROM trips t WHERE t.id=$1 AND t.user_id=$2 AND t.archived_at IS NULL`,
    [tripId, userId],
  );
  if (!result.rowCount) return;
  const trip = result.rows[0];
  const resolve = async (point) => {
    if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon))) return null;
    try {
      return (await photonReverse(Number(point.lat), Number(point.lon))).result?.address || null;
    } catch (error) {
      console.warn("Photon reverse geocoding unavailable:", error.message);
      return null;
    }
  };
  const [start, end] = await Promise.all([
    trip.start_address ? null : resolve(trip.first_point),
    trip.end_address ? null : resolve(trip.last_point),
  ]);
  if (!start && !end) return;
  await pool.query(
    `UPDATE trips SET
       start_address=COALESCE(NULLIF(start_address,''), $3),
       end_address=COALESCE(NULLIF(end_address,''), $4)
     WHERE id=$1 AND user_id=$2 AND archived_at IS NULL`,
    [tripId, userId, start, end],
  );
}
