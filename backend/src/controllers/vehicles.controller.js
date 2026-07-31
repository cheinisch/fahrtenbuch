import { pool } from "../database/pool.js";

export async function listVehicles(req, res) {
  const result = await pool.query(
    `SELECT id, name, manufacturer, model, license_plate AS "licensePlate",
            bluetooth_mac AS "bluetoothMac", created_at AS "createdAt"
       FROM vehicles WHERE user_id=$1 ORDER BY name`,
    [req.user.sub]
  );
  res.json({ items: result.rows });
}

export async function createVehicle(req, res) {
  const { name, manufacturer, model, licensePlate, bluetoothMac } = req.body;
  const result = await pool.query(
    `INSERT INTO vehicles(user_id,name,manufacturer,model,license_plate,bluetooth_mac)
     VALUES($1,$2,$3,$4,$5,$6)
     RETURNING id,name,manufacturer,model,license_plate AS "licensePlate",
               bluetooth_mac AS "bluetoothMac",created_at AS "createdAt"`,
    [req.user.sub, name, manufacturer || null, model || null, licensePlate || null, bluetoothMac || null]
  );
  res.status(201).json(result.rows[0]);
}
