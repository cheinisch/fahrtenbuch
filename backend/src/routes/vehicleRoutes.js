import crypto from "node:crypto";
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
import { sendVehicleShareInvitation } from "../services/mailService.js";

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
  const acquisitionType = stringField(input, "acquisitionType", { maximum: 32 }) || "owned";
  if (!["owned", "leasing", "financing"].includes(acquisitionType)) {
    throw badRequest("INVALID_ACQUISITION_TYPE", "Die Finanzierungsart ist ungültig.");
  }
  const leaseStartDate = stringField(input, "leaseStartDate", { nullable: true, maximum: 10 });
  const leaseEndDate = stringField(input, "leaseEndDate", { nullable: true, maximum: 10 });
  const leaseIncludedKm = numberField(input, "leaseIncludedKm", { nullable: true, minimum: 1, maximum: 10_000_000 });
  const hasContractData = acquisitionType !== "owned" && (leaseStartDate || leaseEndDate || leaseIncludedKm);
  if (hasContractData) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leaseStartDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(leaseEndDate || "")) {
      throw badRequest("INVALID_CONTRACT_DATES", "Für die Kilometerprognose müssen Vertragsbeginn und Vertragsende angegeben werden.");
    }
    if (leaseEndDate <= leaseStartDate) {
      throw badRequest("INVALID_CONTRACT_DATES", "Das Vertragsende muss nach dem Vertragsbeginn liegen.");
    }
    if (!leaseIncludedKm) {
      throw badRequest("INVALID_CONTRACT_KM", "Für die Kilometerprognose muss ein Kilometerlimit angegeben werden.");
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
    acquisitionType,
    isLeased: acquisitionType === "leasing",
    leaseStartDate: hasContractData ? leaseStartDate : null,
    leaseEndDate: hasContractData ? leaseEndDate : null,
    leaseIncludedKm: hasContractData ? Math.round(leaseIncludedKm) : null,
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

async function assertBluetoothTrackingAvailable(client, userId, bluetoothMac, excludeVehicleId = null) {
  if (!bluetoothMac) return;
  const result = await client.query(
    `
      SELECT v.id, v.name
      FROM vehicles v
      WHERE v.bluetooth_identifier = $2
        AND v.archived_at IS NULL
        AND v.deregistered_at IS NULL
        AND ($3::uuid IS NULL OR v.id <> $3)
        AND (
          EXISTS (
            SELECT 1 FROM vehicle_ownership_periods p
            WHERE p.vehicle_id=v.id AND p.user_id=$1
              AND now() >= p.valid_from AND (p.valid_to IS NULL OR now() < p.valid_to)
          )
          OR EXISTS (
            SELECT 1 FROM vehicle_shares s
            WHERE s.vehicle_id=v.id AND s.user_id=$1
          )
        )
      LIMIT 1
    `,
    [userId, bluetoothMac, excludeVehicleId],
  );
  if (result.rowCount) {
    throw conflict(
      "BLUETOOTH_TRACKING_CONFLICT",
      `Die Bluetooth-MAC ist für diesen Benutzer bereits beim aktiven Fahrzeug „${result.rows[0].name}“ trackingfähig.`,
    );
  }
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
              SELECT 1 FROM vehicle_ownership_periods p
              WHERE p.vehicle_id = v.id AND p.user_id = $1
                AND now() >= p.valid_from AND (p.valid_to IS NULL OR now() < p.valid_to)
            )
            OR EXISTS (
              SELECT 1 FROM vehicle_shares vs
              WHERE vs.vehicle_id = v.id AND vs.user_id = $1
            )
            OR EXISTS (
              SELECT 1 FROM trips t
              WHERE t.vehicle_id = v.id AND t.user_id = $1 AND t.archived_at IS NULL
            )
          )
        ORDER BY (v.user_id = $1) DESC, v.is_default DESC, lower(v.name), v.created_at
      `,
      [request.auth.userId],
    );

    response.json(result.rows.map((row) => {
      const mapped=mapVehicle(row);
      if(row.is_owner) return mapped;
      return {
        id:mapped.id,name:mapped.name,manufacturer:mapped.manufacturer,model:mapped.model,
        licensePlate:mapped.licensePlate,color:mapped.color,isDefault:false,
        isOwner:false,accessType:"shared",ownerDisplayName:row.owner_display_name,
        ownerUsername:row.owner_username,isDeregistered:mapped.isDeregistered,
      };
    }));
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
    const vehicleId=uuidValue(request.params.id);
    const vehicle=await loadVehicle(request.auth.userId,vehicleId);
    if(!vehicle) throw notFound("VEHICLE_NOT_FOUND","Das Fahrzeug wurde nicht gefunden.");
    const email=stringField(objectBody(request.body),"email",{required:true,minimum:3,maximum:320}).trim().toLowerCase();
    const userResult=await pool.query(
      `SELECT id,email FROM users WHERE deleted_at IS NULL AND status='active' AND lower(email)=lower($1) LIMIT 1`,[email]);
    if(!userResult.rowCount) throw notFound("USER_NOT_FOUND","Zu dieser E-Mail-Adresse wurde kein aktiver Benutzer gefunden.");
    const target=userResult.rows[0];
    if(target.id===request.auth.userId) throw badRequest("CANNOT_SHARE_WITH_SELF","Das eigene Fahrzeug muss nicht geteilt werden.");
    const existing=await pool.query(`SELECT 1 FROM vehicle_shares WHERE vehicle_id=$1 AND user_id=$2`,[vehicleId,target.id]);
    if(existing.rowCount) throw conflict("VEHICLE_ALREADY_SHARED","Das Fahrzeug ist bereits mit diesem Benutzer geteilt.");
    const token=crypto.randomBytes(32).toString("base64url");
    const hash=crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt=new Date(Date.now()+7*24*60*60*1000);
    const owner=await pool.query(`SELECT display_name,username FROM users WHERE id=$1`,[request.auth.userId]);
    const inserted=await pool.query(
      `INSERT INTO vehicle_share_invitations(vehicle_id,invited_user_id,invited_email,invited_by_user_id,token_hash,expires_at)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (vehicle_id,invited_user_id) WHERE status='pending'
       DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=now()
       RETURNING id,expires_at`,
      [vehicleId,target.id,email,request.auth.userId,hash,expiresAt]);
    const base=(process.env.PUBLIC_BASE_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/,"");
    if(!base) {
      await pool.query(`DELETE FROM vehicle_share_invitations WHERE id=$1`,[inserted.rows[0].id]);
      throw badRequest("SHARE_MAIL_NOT_CONFIGURED","PUBLIC_BASE_URL ist für Freigabeeinladungen nicht konfiguriert.");
    }
    try {
      await sendVehicleShareInvitation({
        to:email, ownerName:owner.rows[0]?.display_name || owner.rows[0]?.username || "Ein Benutzer",
        vehicleName:vehicle.name, acceptUrl:`${base}/share-invitation?token=${encodeURIComponent(token)}`,
        expiresAt:inserted.rows[0].expires_at,
      });
    } catch(error) {
      await pool.query(`DELETE FROM vehicle_share_invitations WHERE id=$1`,[inserted.rows[0].id]);
      throw badRequest("SHARE_MAIL_FAILED",`Die Einladung konnte nicht per E-Mail versendet werden: ${error.message}`);
    }
    response.status(202).json({status:"pending",expiresAt:inserted.rows[0].expires_at});
  }),
);

vehicleRoutes.get(
  "/share-invitations/inspect",
  asyncHandler(async(request,response)=>{
    const token=String(request.query.token || "");
    if(token.length<20) throw notFound("SHARE_INVITATION_NOT_FOUND","Die Einladung wurde nicht gefunden.");
    const hash=crypto.createHash("sha256").update(token).digest("hex");
    await pool.query(`DELETE FROM vehicle_share_invitations
      WHERE invitation_type='link' AND created_at <= now() - interval '7 days'`);
    const result=await pool.query(
      `SELECT i.id,i.status,i.expires_at,i.invitation_type,i.invited_user_id,
              v.name AS vehicle_name,u.display_name AS owner_display_name,u.username AS owner_username
       FROM vehicle_share_invitations i
       INNER JOIN vehicles v ON v.id=i.vehicle_id
       INNER JOIN users u ON u.id=i.invited_by_user_id
       WHERE i.token_hash=$1 LIMIT 1`,[hash]);
    if(!result.rowCount) throw notFound("SHARE_INVITATION_NOT_FOUND","Link ist unbekannt.");
    const row=result.rows[0];
    const expired=new Date(row.expires_at).getTime()<=Date.now();
    if(expired&&row.status==="pending") await pool.query(`UPDATE vehicle_share_invitations SET status='expired' WHERE id=$1`,[row.id]);
    response.json({
      status:expired?"expired":row.status,expired,vehicleName:row.vehicle_name,
      ownerName:row.owner_display_name||row.owner_username,expiresAt:row.expires_at,
      invitationType:row.invitation_type,
      intendedForCurrentUser:row.invitation_type==="link" || row.invited_user_id===request.auth.userId,
    });
  })
);

vehicleRoutes.get(
  "/share-invitations/pending",
  asyncHandler(async(request,response)=>{
    const result=await pool.query(
      `SELECT i.id,i.expires_at,i.created_at,v.name AS vehicle_name,
              u.display_name AS owner_display_name,u.username AS owner_username
       FROM vehicle_share_invitations i
       INNER JOIN vehicles v ON v.id=i.vehicle_id
       INNER JOIN users u ON u.id=i.invited_by_user_id
       WHERE i.invited_user_id=$1 AND i.status='pending' AND i.expires_at>now()
       ORDER BY i.created_at DESC`,[request.auth.userId]);
    response.json(result.rows.map(r=>({id:r.id,vehicleName:r.vehicle_name,ownerName:r.owner_display_name||r.owner_username,expiresAt:r.expires_at,createdAt:r.created_at})));
  })
);

vehicleRoutes.post(
  "/share-invitations/respond",
  asyncHandler(async(request,response)=>{
    const body=objectBody(request.body);
    const token=stringField(body,"token",{required:true,minimum:20,maximum:200});
    const action=stringField(body,"action",{required:true,minimum:6,maximum:7});
    if(!["accept","decline"].includes(action)) throw badRequest("INVALID_SHARE_RESPONSE","Ungültige Antwort.");
    const hash=crypto.createHash("sha256").update(token).digest("hex");
    await pool.query(`DELETE FROM vehicle_share_invitations
      WHERE invitation_type='link' AND created_at <= now() - interval '7 days'`);
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const inv=await client.query(
        `SELECT i.*,v.bluetooth_identifier,v.deregistered_at
         FROM vehicle_share_invitations i INNER JOIN vehicles v ON v.id=i.vehicle_id
         WHERE i.token_hash=$1 FOR UPDATE`,[hash]);
      if(!inv.rowCount) throw notFound("SHARE_INVITATION_NOT_FOUND","Die Einladung wurde nicht gefunden.");
      const row=inv.rows[0];
      if(new Date(row.expires_at).getTime()<=Date.now()){
        if(row.status==="pending") await client.query(`UPDATE vehicle_share_invitations SET status='expired' WHERE id=$1`,[row.id]);
        await client.query("COMMIT");
        return response.status(410).json({error:{code:"SHARE_INVITATION_EXPIRED",message:"Link ist abgelaufen."}});
      }
      if(row.status!=="pending") throw conflict("SHARE_INVITATION_USED","Diese Einladung wurde bereits beantwortet.");
      if(row.invitation_type==="email" && row.invited_user_id!==request.auth.userId)
        throw badRequest("SHARE_INVITATION_WRONG_USER","Diese Einladung wurde für einen anderen Benutzer erstellt.");
      if(row.invited_by_user_id===request.auth.userId)
        throw badRequest("CANNOT_SHARE_WITH_SELF","Du kannst dein eigenes Fahrzeug nicht über einen Freigabelink übernehmen.");
      if(action==="decline"){
        await client.query(`UPDATE vehicle_share_invitations SET status='declined',responded_at=now(),accepted_by_user_id=$2 WHERE id=$1`,[row.id,request.auth.userId]);
        await client.query("COMMIT"); return response.json({status:"declined"});
      }
      if(row.bluetooth_identifier&&!row.deregistered_at) await assertBluetoothTrackingAvailable(client,request.auth.userId,row.bluetooth_identifier,row.vehicle_id);
      await client.query(`INSERT INTO vehicle_shares(vehicle_id,user_id,granted_by_user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [row.vehicle_id,request.auth.userId,row.invited_by_user_id]);
      await client.query(`UPDATE vehicle_share_invitations SET status='accepted',responded_at=now(),accepted_by_user_id=$2,use_count=use_count+1 WHERE id=$1`,[row.id,request.auth.userId]);
      await client.query("COMMIT"); response.json({status:"accepted",vehicleId:row.vehicle_id});
    } catch(error){await client.query("ROLLBACK");throw error;} finally{client.release();}
  })
);

vehicleRoutes.post(
  "/:id/share-link",
  asyncHandler(async(request,response)=>{
    const vehicleId=uuidValue(request.params.id);
    const vehicle=await loadVehicle(request.auth.userId,vehicleId);
    if(!vehicle) throw notFound("VEHICLE_NOT_FOUND","Das Fahrzeug wurde nicht gefunden.");
    const token=crypto.randomBytes(32).toString("base64url");
    const hash=crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt=new Date(Date.now()+24*60*60*1000);
    await pool.query(
      `INSERT INTO vehicle_share_invitations(vehicle_id,invited_by_user_id,token_hash,status,expires_at,invitation_type,max_uses)
       VALUES($1,$2,$3,'pending',$4,'link',1)`,[vehicleId,request.auth.userId,hash,expiresAt]);
    const base=(process.env.PUBLIC_BASE_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/,"");
    if(!base) throw badRequest("SHARE_LINK_NOT_CONFIGURED","PUBLIC_BASE_URL ist für Freigabelinks nicht konfiguriert.");
    response.status(201).json({url:`${base}/share-invitation?token=${encodeURIComponent(token)}`,expiresAt});
  })
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

vehicleRoutes.get(
  "/archive",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT v.*
       FROM vehicles v
       WHERE v.user_id = $1
         AND v.archived_at IS NOT NULL
       ORDER BY v.archived_at DESC, v.name ASC`,
      [request.auth.userId],
    );
    response.json(result.rows.map((row) => ({
      ...mapVehicle(row),
      isOwner: true,
      accessType: "owner",
      archivedAt: row.archived_at,
    })));
  }),
);

vehicleRoutes.post(
  "/:id/restore",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const result = await pool.query(
      `UPDATE vehicles
       SET archived_at = NULL,
           deregistered_at = COALESCE(deregistered_at, now()),
           is_default = false
       WHERE id = $1
         AND user_id = $2
         AND archived_at IS NOT NULL
       RETURNING *`,
      [vehicleId, request.auth.userId],
    );
    if (!result.rowCount) throw notFound("VEHICLE_NOT_FOUND", "Das archivierte Fahrzeug wurde nicht gefunden.");
    response.json(mapVehicle(result.rows[0]));
  }),
);

vehicleRoutes.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = parseVehicleInput(request.body);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await assertBluetoothTrackingAvailable(client, request.auth.userId, input.bluetoothMac);
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
            lease_included_km,
            acquisition_type
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
          input.acquisitionType,
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
      await assertBluetoothTrackingAvailable(client, request.auth.userId, input.bluetoothMac, vehicleId);

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
            lease_included_km = $16,
            acquisition_type = $17
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
          input.acquisitionType,
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

vehicleRoutes.post(
  "/:id/deregister",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const body = objectBody(request.body);
    const confirmed = booleanField(body, "confirmed") ?? false;
    if (!confirmed) {
      throw badRequest("DEREGISTRATION_CONFIRMATION_REQUIRED", "Die Abmeldung muss ausdrücklich bestätigt werden.");
    }
    const vehicle = await loadVehicle(request.auth.userId, vehicleId);
    if (!vehicle) throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    const at = new Date();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE vehicles SET deregistered_at=$3, is_default=false
         WHERE id=$1 AND user_id=$2 AND deregistered_at IS NULL`,
        [vehicleId, request.auth.userId, at],
      );
      await client.query(
        `UPDATE vehicle_ownership_periods SET valid_to=$3
         WHERE vehicle_id=$1 AND user_id=$2 AND valid_to IS NULL`,
        [vehicleId, request.auth.userId, at],
      );
      await client.query("COMMIT");
      const updated = await loadVehicle(request.auth.userId, vehicleId);
      response.json(mapVehicle(updated));
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }),
);

vehicleRoutes.post(
  "/:id/register",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const vehicle = await loadVehicle(request.auth.userId, vehicleId);
    if (!vehicle) throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    if (!vehicle.deregistered_at) {
      throw conflict("VEHICLE_ALREADY_REGISTERED", "Das Fahrzeug ist bereits angemeldet.");
    }

    const body = objectBody(request.body);
    const effectiveAtRaw = body.effectiveAt == null
      ? new Date().toISOString()
      : stringField(body, "effectiveAt", { required: true, maximum: 40 });
    const effectiveAt = new Date(effectiveAtRaw);
    if (Number.isNaN(effectiveAt.getTime())) {
      throw badRequest("INVALID_REGISTRATION_DATE", "Der Anmeldezeitpunkt ist ungültig.");
    }
    if (effectiveAt < new Date(vehicle.deregistered_at)) {
      throw badRequest("INVALID_REGISTRATION_DATE", "Die Wiederanmeldung darf nicht vor der Abmeldung liegen.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT id FROM vehicle_ownership_periods
         WHERE vehicle_id=$1 AND valid_to IS NULL
         LIMIT 1 FOR UPDATE`,
        [vehicleId],
      );
      if (current.rowCount) {
        throw conflict("VEHICLE_ALREADY_REGISTERED", "Für das Fahrzeug besteht bereits eine aktive Besitzperiode.");
      }
      await client.query(
        `INSERT INTO vehicle_ownership_periods (vehicle_id,user_id,valid_from,created_by_user_id)
         VALUES ($1,$2,$3,$2)`,
        [vehicleId, request.auth.userId, effectiveAt],
      );
      await client.query(
        `UPDATE vehicles SET deregistered_at=NULL WHERE id=$1 AND user_id=$2 AND archived_at IS NULL`,
        [vehicleId, request.auth.userId],
      );
      await client.query("COMMIT");
      const updated = await loadVehicle(request.auth.userId, vehicleId);
      response.json(mapVehicle(updated));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

vehicleRoutes.post(
  "/:id/transfer",
  asyncHandler(async (request, response) => {
    const vehicleId = uuidValue(request.params.id);
    const body = objectBody(request.body);
    const account = stringField(body, "account", { required: true, minimum: 1, maximum: 320 });
    const effectiveAtRaw = stringField(body, "effectiveAt", { required: true, maximum: 40 });
    const effectiveAt = new Date(effectiveAtRaw);
    if (Number.isNaN(effectiveAt.getTime())) throw badRequest("INVALID_TRANSFER_DATE", "Der Übergabezeitpunkt ist ungültig.");
    const vehicle = await loadVehicle(request.auth.userId, vehicleId);
    if (!vehicle) throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
    if (vehicle.deregistered_at) throw conflict("VEHICLE_DEREGISTERED", "Ein abgemeldetes Fahrzeug kann nicht übertragen werden.");
    const targetResult = await pool.query(
      `SELECT id, username, display_name, email FROM users
       WHERE deleted_at IS NULL AND status='active'
         AND (lower(email)=lower($1) OR lower(username)=lower($1)) LIMIT 1`,
      [account.trim()],
    );
    if (!targetResult.rowCount) throw notFound("USER_NOT_FOUND", "Der neue Besitzer wurde nicht gefunden.");
    const target = targetResult.rows[0];
    if (target.id === request.auth.userId) throw badRequest("INVALID_TRANSFER", "Das Fahrzeug gehört bereits diesem Benutzer.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT * FROM vehicle_ownership_periods
         WHERE vehicle_id=$1 AND user_id=$2 AND valid_to IS NULL
         ORDER BY valid_from DESC LIMIT 1 FOR UPDATE`,
        [vehicleId, request.auth.userId],
      );
      if (!current.rowCount || effectiveAt <= new Date(current.rows[0].valid_from)) {
        throw badRequest("INVALID_TRANSFER_DATE", "Der Übergabezeitpunkt muss innerhalb der aktuellen Besitzperiode liegen.");
      }
      await client.query(`UPDATE vehicle_ownership_periods SET valid_to=$2 WHERE id=$1`, [current.rows[0].id, effectiveAt]);
      await client.query(
        `INSERT INTO vehicle_ownership_periods (vehicle_id,user_id,valid_from,created_by_user_id)
         VALUES ($1,$2,$3,$4)`,
        [vehicleId,target.id,effectiveAt,request.auth.userId],
      );
      await client.query(
        `UPDATE vehicles SET user_id=$2, is_default=false WHERE id=$1`,
        [vehicleId,target.id],
      );
      await client.query("COMMIT");
      response.status(201).json({ vehicleId, previousOwnerUserId: request.auth.userId, newOwnerUserId: target.id, effectiveAt: effectiveAt.toISOString() });
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
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

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertBluetoothTrackingAvailable(client, request.auth.userId, bluetoothMac, vehicleId);
      const result = await client.query(
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
