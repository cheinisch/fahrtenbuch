import { Router } from "express";

import { pool } from "../database/pool.js";
import {
  badRequest,
  conflict,
  notFound,
} from "../lib/errors.js";
import { mapVehicle } from "../lib/mappers.js";
import {
  booleanField,
  numberField,
  objectBody,
  stringField,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const vehicleRoutes = Router();

vehicleRoutes.use(requireAuth);

function bluetoothValue(body, required = false) {
  const value = stringField(body, "bluetoothMac", {
    required,
    nullable: true,
    maximum: 64,
  });

  if (
    value !== undefined &&
    value !== null &&
    !/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(value)
  ) {
    throw badRequest(
      "INVALID_BLUETOOTH_MAC",
      "Die Bluetooth-MAC-Adresse ist ungültig.",
    );
  }

  return value?.toUpperCase() ?? value;
}

function parseVehicleInput(body) {
  const input = objectBody(body);
  const name = stringField(input, "name", {
    required: true,
    minimum: 1,
    maximum: 120,
  });
  const odometerKm = numberField(input, "odometerKm", {
    nullable: true,
    minimum: 0,
    maximum: 1_000_000_000,
  });

  const bluetoothMac = bluetoothValue(input);

  return {
    name,
    manufacturer: stringField(input, "manufacturer", {
      nullable: true,
      maximum: 120,
    }),
    model: stringField(input, "model", {
      nullable: true,
      maximum: 120,
    }),
    licensePlate: stringField(input, "licensePlate", {
      nullable: true,
      maximum: 64,
    }),
    vin: stringField(input, "vin", {
      nullable: true,
      maximum: 64,
    }),
    odometerMeters:
      odometerKm === undefined || odometerKm === null
        ? odometerKm
        : Math.round(odometerKm * 1000),
    color: stringField(input, "color", {
      nullable: true,
      maximum: 64,
    }),
    notes: stringField(input, "notes", {
      nullable: true,
      maximum: 10_000,
    }),
    bluetoothMac,
    isDefault: booleanField(input, "isDefault") ?? false,
  };
}

async function loadVehicle(userId, vehicleId) {
  const result = await pool.query(
    `
      SELECT *
      FROM vehicles
      WHERE id = $1
        AND user_id = $2
        AND archived_at IS NULL
      LIMIT 1
    `,
    [vehicleId, userId],
  );

  return result.rows[0] || null;
}

vehicleRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `
        SELECT *
        FROM vehicles
        WHERE user_id = $1
          AND archived_at IS NULL
        ORDER BY is_default DESC, lower(name), created_at
      `,
      [request.auth.userId],
    );

    response.json(result.rows.map(mapVehicle));
  }),
);

vehicleRoutes.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = parseVehicleInput(request.body);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const countResult = await client.query(
        `
          SELECT count(*)::integer AS count
          FROM vehicles
          WHERE user_id = $1
            AND archived_at IS NULL
        `,
        [request.auth.userId],
      );

      const shouldBeDefault =
        input.isDefault || countResult.rows[0].count === 0;

      if (shouldBeDefault) {
        await client.query(
          `
            UPDATE vehicles
            SET is_default = false
            WHERE user_id = $1
              AND archived_at IS NULL
          `,
          [request.auth.userId],
        );
      }

      const result = await client.query(
        `
          INSERT INTO vehicles (
            user_id,
            name,
            manufacturer,
            model,
            license_plate,
            vin,
            odometer_meters,
            color,
            notes,
            bluetooth_identifier,
            is_default
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `,
        [
          request.auth.userId,
          input.name,
          input.manufacturer,
          input.model,
          input.licensePlate,
          input.vin,
          input.odometerMeters,
          input.color,
          input.notes,
          input.bluetoothMac,
          shouldBeDefault,
        ],
      );

      await client.query("COMMIT");
      response.status(201).json(mapVehicle(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");

      if (
        error?.constraint === "vehicles_bluetooth_unique_per_user"
      ) {
        throw conflict(
          "BLUETOOTH_ALREADY_ASSIGNED",
          "Diese Bluetooth-MAC-Adresse ist bereits einem Fahrzeug zugeordnet.",
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }),
);

vehicleRoutes.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const vehicle = await loadVehicle(request.auth.userId, vehicleId);

    if (!vehicle) {
      throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    }

    response.json(mapVehicle(vehicle));
  }),
);

vehicleRoutes.put(
  "/:id",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const input = parseVehicleInput(request.body);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (input.isDefault) {
        await client.query(
          `
            UPDATE vehicles
            SET is_default = false
            WHERE user_id = $1
              AND id <> $2
              AND archived_at IS NULL
          `,
          [request.auth.userId, vehicleId],
        );
      }

      const result = await client.query(
        `
          UPDATE vehicles
          SET
            name = $3,
            manufacturer = $4,
            model = $5,
            license_plate = $6,
            vin = $7,
            odometer_meters = $8,
            color = $9,
            notes = $10,
            bluetooth_identifier = $11,
            is_default = CASE
              WHEN $12 THEN true
              ELSE is_default
            END
          WHERE id = $1
            AND user_id = $2
            AND archived_at IS NULL
          RETURNING *
        `,
        [
          vehicleId,
          request.auth.userId,
          input.name,
          input.manufacturer,
          input.model,
          input.licensePlate,
          input.vin,
          input.odometerMeters,
          input.color,
          input.notes,
          input.bluetoothMac,
          input.isDefault,
        ],
      );

      if (result.rowCount === 0) {
        throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
      }

      await client.query("COMMIT");
      response.json(mapVehicle(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        error?.constraint === "vehicles_bluetooth_unique_per_user"
      ) {
        throw conflict(
          "BLUETOOTH_ALREADY_ASSIGNED",
          "Diese Bluetooth-MAC-Adresse ist bereits einem Fahrzeug zugeordnet.",
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }),
);

vehicleRoutes.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);

    const activeTrip = await pool.query(
      `
        SELECT 1
        FROM trips
        WHERE vehicle_id = $1
          AND user_id = $2
          AND status = 'recording'
          AND archived_at IS NULL
        LIMIT 1
      `,
      [vehicleId, request.auth.userId],
    );

    if (activeTrip.rowCount > 0) {
      throw conflict(
        "VEHICLE_HAS_ACTIVE_TRIP",
        "Das Fahrzeug kann während einer aktiven Aufzeichnung nicht gelöscht werden.",
      );
    }

    const result = await pool.query(
      `
        UPDATE vehicles
        SET
          archived_at = now(),
          is_default = false,
          bluetooth_identifier = NULL
        WHERE id = $1
          AND user_id = $2
          AND archived_at IS NULL
        RETURNING id
      `,
      [vehicleId, request.auth.userId],
    );

    if (result.rowCount === 0) {
      throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    }

    response.status(204).end();
  }),
);

vehicleRoutes.put(
  "/:id/default",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const owned = await client.query(
        `
          SELECT id
          FROM vehicles
          WHERE id = $1
            AND user_id = $2
            AND archived_at IS NULL
          LIMIT 1
          FOR UPDATE
        `,
        [vehicleId, request.auth.userId],
      );

      if (owned.rowCount === 0) {
        throw notFound(
          "VEHICLE_NOT_FOUND",
          "Das Fahrzeug wurde nicht gefunden.",
        );
      }

      await client.query(
        `
          UPDATE vehicles
          SET is_default = false
          WHERE user_id = $1
            AND archived_at IS NULL
        `,
        [request.auth.userId],
      );

      const result = await client.query(
        `
          UPDATE vehicles
          SET is_default = true
          WHERE id = $1
            AND user_id = $2
          RETURNING *
        `,
        [vehicleId, request.auth.userId],
      );

      await client.query("COMMIT");
      response.json(mapVehicle(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

vehicleRoutes.put(
  "/:id/bluetooth",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const body = objectBody(request.body);
    const bluetoothMac = bluetoothValue(body, true);

    try {
      const result = await pool.query(
        `
          UPDATE vehicles
          SET bluetooth_identifier = $3
          WHERE id = $1
            AND user_id = $2
            AND archived_at IS NULL
          RETURNING *
        `,
        [vehicleId, request.auth.userId, bluetoothMac],
      );

      if (result.rowCount === 0) {
        throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
      }

      response.json(mapVehicle(result.rows[0]));
    } catch (error) {
      if (
        error?.constraint === "vehicles_bluetooth_unique_per_user"
      ) {
        throw conflict(
          "BLUETOOTH_ALREADY_ASSIGNED",
          "Diese Bluetooth-MAC-Adresse ist bereits einem Fahrzeug zugeordnet.",
        );
      }

      throw error;
    }
  }),
);
