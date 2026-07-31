import { pool } from "../database/pool.js";

export async function listTrips(req, res) {
  const result = await pool.query(
    `SELECT id, vehicle_id AS "vehicleId", started_at AS "startedAt", ended_at AS "endedAt",
            start_address AS "startAddress", end_address AS "endAddress",
            distance_km AS "distanceKm", purpose, notes, created_at AS "createdAt"
       FROM trips WHERE user_id=$1 ORDER BY started_at DESC LIMIT 100`,
    [req.user.sub]
  );
  res.json({ items: result.rows });
}

export async function createTrip(req, res) {
  const b = req.body;
  const result = await pool.query(
    `INSERT INTO trips(user_id,vehicle_id,started_at,ended_at,start_address,end_address,distance_km,purpose,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id,vehicle_id AS "vehicleId",started_at AS "startedAt",ended_at AS "endedAt",
               start_address AS "startAddress",end_address AS "endAddress",
               distance_km AS "distanceKm",purpose,notes,created_at AS "createdAt"`,
    [req.user.sub,b.vehicleId,b.startedAt,b.endedAt||null,b.startAddress||null,b.endAddress||null,b.distanceKm||0,b.purpose||"private",b.notes||null]
  );
  res.status(201).json(result.rows[0]);
}
