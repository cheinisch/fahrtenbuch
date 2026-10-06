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
  const isLeased = booleanField(input, "isLeased") ?? false;
  const leaseStartDate = stringField(input, "leaseStartDate", { nullable: true, maximum: 10 });
  const leaseEndDate = stringField(input, "leaseEndDate", { nullable: true, maximum: 10 });
  const leaseIncludedKm = numberField(input, "leaseIncludedKm", { nullable: true, minimum: 1, maximum: 10_000_000 });
  if (isLeased) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leaseStartDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(leaseEndDate || "")) {
      throw badRequest("INVALID_LEASE_DATES", "Für ein Leasingfahrzeug müssen Vertragsbeginn und Vertragsende angegeben werden.");
    }
    if (leaseEndDate <= leaseStartDate) {
      throw badRequest("INVALID_LEASE_DATES", "Das Leasingende muss nach dem Vertragsbeginn liegen.");
    }
    if (!leaseIncludedKm) {
      throw badRequest("INVALID_LEASE_KM", "Für ein Leasingfahrzeug müssen die Inklusivkilometer angegeben werden.");
    }
  }

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
    isLeased,
    leaseStartDate: isLeased ? leaseStartDate : null,
    leaseEndDate: isLeased ? leaseEndDate : null,
    leaseIncludedKm: isLeased ? Math.round(leaseIncludedKm) : null,
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
        SELECT
          v.*,
          (v.user_id = $1) AS is_owner,
          owner.display_name AS owner_display_name,
          owner.username AS owner_username,
          CASE WHEN v.user_id = $1 THEN 'owner' ELSE 'shared' END AS access_type
        FROM vehicles v
        INNER JOIN users owner ON owner.id = v.user_id
        WHERE v.archived_at IS NULL
          AND (
            v.user_id = $1
            OR EXISTS (
              SELECT 1
              FROM vehicle_shares vs
              WHERE vs.vehicle_id = v.id
                AND vs.user_id = $1
            )
          )
        ORDER BY (v.user_id = $1) DESC, v.is_default DESC, lower(v.name), v.created_at
      `,
      [request.auth.userId],
    );

    response.json(result.rows.map(mapVehicle));
  }),
);

vehicleRoutes.get(
  "/:id/shared-trip-activity",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const vehicle = await loadVehicle(request.auth.userId, vehicleId);
    if (!vehicle) {
      throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    }

    const result = await pool.query(
      `
        SELECT
          t.user_id,
          u.display_name,
          u.username,
          count(*)::integer AS trip_count
        FROM trips t
        INNER JOIN users u ON u.id = t.user_id
        WHERE t.vehicle_id = $1
          AND t.user_id <> $2
          AND t.archived_at IS NULL
          AND t.status <> 'cancelled'
        GROUP BY t.user_id, u.display_name, u.username
        ORDER BY lower(u.display_name), lower(u.username)
      `,
      [vehicleId, request.auth.userId],
    );

    response.json(result.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      username: row.username,
      tripCount: Number(row.trip_count || 0),
      label: `Fahrten ${row.display_name || row.username}`,
    })));
  }),
);

vehicleRoutes.get(
  "/:id/shares",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const vehicle = await loadVehicle(request.auth.userId, vehicleId);
    if (!vehicle) {
      throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    }

    const result = await pool.query(
      `
        SELECT vs.user_id, u.username, u.display_name, u.email, vs.created_at
        FROM vehicle_shares vs
        INNER JOIN users u ON u.id = vs.user_id
        WHERE vs.vehicle_id = $1
        ORDER BY lower(u.display_name), lower(u.username)
      `,
      [vehicleId],
    );

    response.json(result.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      createdAt: row.created_at,
    })));
  }),
);

vehicleRoutes.post(
  "/:id/shares",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const vehicle = await loadVehicle(request.auth.userId, vehicleId);
    if (!vehicle) {
      throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    }

    const body = objectBody(request.body);
    const account = stringField(body, "account", {
      required: true,
      minimum: 1,
      maximum: 320,
    });

    const userResult = await pool.query(
      `
        SELECT id, username, display_name, email
        FROM users
        WHERE deleted_at IS NULL
          AND status = 'active'
          AND (lower(email) = lower($1) OR lower(username) = lower($1))
        LIMIT 1
      `,
      [account.trim()],
    );

    if (userResult.rowCount === 0) {
      throw notFound("USER_NOT_FOUND", "Der Benutzer wurde nicht gefunden.");
    }

    const target = userResult.rows[0];
    if (target.id === request.auth.userId) {
      throw badRequest("CANNOT_SHARE_WITH_SELF", "Das eigene Fahrzeug muss nicht geteilt werden.");
    }

    const result = await pool.query(
      `
        INSERT INTO vehicle_shares (vehicle_id, user_id, granted_by_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (vehicle_id, user_id) DO NOTHING
        RETURNING created_at
      `,
      [vehicleId, target.id, request.auth.userId],
    );

    if (result.rowCount === 0) {
      throw conflict("VEHICLE_ALREADY_SHARED", "Das Fahrzeug ist bereits mit diesem Benutzer geteilt.");
    }

    response.status(201).json({
      userId: target.id,
      username: target.username,
      displayName: target.display_name,
      email: target.email,
      createdAt: result.rows[0].created_at,
    });
  }),
);

vehicleRoutes.delete(
  "/:id/shares/:userId",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const sharedUserId = uuidValue(request.params.userId, "userId");
    const vehicle = await loadVehicle(request.auth.userId, vehicleId);
    if (!vehicle) {
      throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    }

    const result = await pool.query(
      `
        DELETE FROM vehicle_shares
        WHERE vehicle_id = $1 AND user_id = $2
        RETURNING user_id
      `,
      [vehicleId, sharedUserId],
    );

    if (result.rowCount === 0) {
      throw notFound("VEHICLE_SHARE_NOT_FOUND", "Die Fahrzeugfreigabe wurde nicht gefunden.");
    }

    response.status(204).end();
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
            is_default,
            is_leased,
            lease_start_date,
            lease_end_date,
            lease_included_km
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
          input.isLeased,
          input.leaseStartDate,
          input.leaseEndDate,
          input.leaseIncludedKm,
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
            END,
            is_leased = $13,
            lease_start_date = $14,
            lease_end_date = $15,
            lease_included_km = $16
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
          input.isLeased,
          input.leaseStartDate,
          input.leaseEndDate,
          input.leaseIncludedKm,
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
