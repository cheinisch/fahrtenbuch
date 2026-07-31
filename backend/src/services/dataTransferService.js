import {
  createHash,
  randomUUID,
} from "node:crypto";

import { config } from "../config.js";
import {
  badRequest,
  conflict,
} from "../lib/errors.js";

export const DATA_TRANSFER_SCHEMA_VERSION = 1;
export const USER_DATA_KIND =
  "fahrtenbuch-user-data";
export const SYSTEM_DATA_KIND =
  "fahrtenbuch-system-data";

const DATA_TABLES = Object.freeze({
  userSettings: "user_settings",
  vehicles: "vehicles",
  tags: "tags",
  trips: "trips",
  trackPoints: "track_points",
  tripTags: "trip_tags",
  tripChangeLog: "trip_change_log",
  appSettings: "app_settings",
});

const columnCache = new Map();

function quoteIdentifier(value) {
  return `"${String(value).replaceAll(
    '"',
    '""',
  )}"`;
}

function ensureObject(value, field) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw badRequest(
      "INVALID_DATA_EXPORT",
      `${field} muss ein Objekt sein.`,
    );
  }

  return value;
}

function ensureArray(value, field) {
  if (!Array.isArray(value)) {
    throw badRequest(
      "INVALID_DATA_EXPORT",
      `${field} muss eine Liste sein.`,
    );
  }

  return value;
}

function normalizedEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizedUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizedUuid(value) {
  const candidate = String(value || "")
    .trim()
    .toLowerCase();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    candidate,
  )
    ? candidate
    : null;
}

function cleanUserRecord(record) {
  const input = {
    ...record,
  };

  delete input.password_hash;
  delete input.password_changed_at;
  delete input.totp_secret_encrypted;
  delete input.totp_enabled;
  delete input.last_login_at;

  return input;
}

function portableOwner(record) {
  const input = cleanUserRecord(record);

  return {
    id: input.id,
    email: input.email,
    username: input.username,
    display_name: input.display_name,
    first_name:
      input.first_name ?? null,
    last_name:
      input.last_name ?? null,
    locale: input.locale,
    timezone: input.timezone,
    theme_mode: input.theme_mode,
    created_at: input.created_at,
    updated_at: input.updated_at,
  };
}

async function tableExists(
  client,
  table,
) {
  const result = await client.query(
    `
      SELECT to_regclass($1) IS NOT NULL AS exists
    `,
    [`public.${table}`],
  );

  return Boolean(result.rows[0]?.exists);
}

async function fetchJsonRows(
  client,
  table,
  {
    where = "",
    parameters = [],
    orderBy = "",
  } = {},
) {
  if (
    !(await tableExists(
      client,
      table,
    ))
  ) {
    return [];
  }

  const query = [
    `SELECT to_jsonb(source_row) AS record`,
    `FROM ${quoteIdentifier(table)} source_row`,
    where ? `WHERE ${where}` : "",
    orderBy ? `ORDER BY ${orderBy}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await client.query(
    query,
    parameters,
  );

  return result.rows.map(
    (row) => row.record,
  );
}

async function fetchUserRecord(
  client,
  userId,
) {
  const result = await client.query(
    `
      SELECT to_jsonb(u) AS record
      FROM users u
      WHERE u.id = $1
      LIMIT 1
    `,
    [userId],
  );

  if (!result.rows[0]?.record) {
    throw badRequest(
      "USER_NOT_FOUND",
      "Der Benutzer wurde nicht gefunden.",
    );
  }

  return cleanUserRecord(
    result.rows[0].record,
  );
}

async function getWritableColumns(
  client,
  table,
) {
  if (columnCache.has(table)) {
    return columnCache.get(table);
  }

  const result = await client.query(
    `
      SELECT
        column_name,
        is_identity,
        is_generated
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [table],
  );

  if (result.rowCount === 0) {
    throw badRequest(
      "IMPORT_TABLE_MISSING",
      `Die benötigte Tabelle ${table} existiert nicht.`,
    );
  }

  const columns = result.rows
    .filter(
      (row) =>
        row.is_identity !== "YES" &&
        row.is_generated === "NEVER",
    )
    .map((row) => row.column_name);

  columnCache.set(table, columns);

  return columns;
}

function parameterValue(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    return JSON.stringify(value);
  }

  return value;
}

async function upsertRecord(
  client,
  table,
  sourceRecord,
  {
    conflictColumns,
    excludeColumns = [],
    doNothing = false,
  },
) {
  const record = ensureObject(
    sourceRecord,
    `${table}-Datensatz`,
  );

  const writableColumns =
    await getWritableColumns(
      client,
      table,
    );

  const excluded = new Set(
    excludeColumns,
  );

  const columns =
    writableColumns.filter(
      (column) =>
        !excluded.has(column) &&
        Object.hasOwn(record, column) &&
        record[column] !== undefined,
    );

  if (columns.length === 0) {
    throw badRequest(
      "INVALID_IMPORT_RECORD",
      `Für ${table} wurden keine importierbaren Felder gefunden.`,
    );
  }

  for (
    const conflictColumn of
    conflictColumns
  ) {
    if (!columns.includes(conflictColumn)) {
      throw badRequest(
        "INVALID_IMPORT_RECORD",
        `Das Konfliktfeld ${conflictColumn} fehlt in ${table}.`,
      );
    }
  }

  const placeholders = columns.map(
    (_column, index) => `$${index + 1}`,
  );

  const updateColumns = columns.filter(
    (column) =>
      !conflictColumns.includes(column),
  );

  const conflictSql = doNothing ||
    updateColumns.length === 0
    ? "DO NOTHING"
    : `DO UPDATE SET ${updateColumns
        .map(
          (column) =>
            `${quoteIdentifier(
              column,
            )} = EXCLUDED.${quoteIdentifier(
              column,
            )}`,
        )
        .join(", ")}`;

  const sql = `
    INSERT INTO ${quoteIdentifier(
      table,
    )} (
      ${columns
        .map(quoteIdentifier)
        .join(", ")}
    )
    VALUES (
      ${placeholders.join(", ")}
    )
    ON CONFLICT (
      ${conflictColumns
        .map(quoteIdentifier)
        .join(", ")}
    )
    ${conflictSql}
  `;

  await client.query(
    sql,
    columns.map((column) =>
      parameterValue(record[column]),
    ),
  );
}

async function selectOwnedId(
  client,
  table,
  sourceId,
  userId,
) {
  const id = normalizedUuid(sourceId);

  if (!id) {
    return null;
  }

  const result = await client.query(
    `
      SELECT user_id
      FROM ${quoteIdentifier(table)}
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  if (result.rowCount === 0) {
    return id;
  }

  return result.rows[0].user_id ===
    userId
    ? id
    : null;
}

async function resolveVehicleId(
  client,
  source,
  targetUserId,
) {
  const ownedId =
    await selectOwnedId(
      client,
      DATA_TABLES.vehicles,
      source.id,
      targetUserId,
    );

  if (ownedId) {
    return ownedId;
  }

  if (source.bluetooth_identifier) {
    const byBluetooth =
      await client.query(
        `
          SELECT id
          FROM vehicles
          WHERE user_id = $1
            AND lower(
              bluetooth_identifier
            ) = lower($2)
          LIMIT 1
        `,
        [
          targetUserId,
          source.bluetooth_identifier,
        ],
      );

    if (byBluetooth.rowCount > 0) {
      return byBluetooth.rows[0].id;
    }
  }

  if (source.license_plate) {
    const byPlate =
      await client.query(
        `
          SELECT id
          FROM vehicles
          WHERE user_id = $1
            AND lower(
              license_plate
            ) = lower($2)
          LIMIT 1
        `,
        [
          targetUserId,
          source.license_plate,
        ],
      );

    if (byPlate.rowCount > 0) {
      return byPlate.rows[0].id;
    }
  }

  return randomUUID();
}

async function resolveTagId(
  client,
  source,
  targetUserId,
) {
  const ownedId =
    await selectOwnedId(
      client,
      DATA_TABLES.tags,
      source.id,
      targetUserId,
    );

  if (ownedId) {
    return ownedId;
  }

  if (source.name) {
    const byName =
      await client.query(
        `
          SELECT id
          FROM tags
          WHERE user_id = $1
            AND lower(name) = lower($2)
          LIMIT 1
        `,
        [targetUserId, source.name],
      );

    if (byName.rowCount > 0) {
      return byName.rows[0].id;
    }
  }

  return randomUUID();
}

async function resolveTripId(
  client,
  sourceId,
  targetUserId,
) {
  const ownedId =
    await selectOwnedId(
      client,
      DATA_TABLES.trips,
      sourceId,
      targetUserId,
    );

  return ownedId || randomUUID();
}

function changeImportKey(
  bundleId,
  record,
) {
  if (record.import_key) {
    return String(record.import_key);
  }

  return createHash("sha256")
    .update(
      JSON.stringify({
        bundleId,
        id: record.id ?? null,
        tripId:
          record.trip_id ?? null,
        operation:
          record.operation ?? null,
        changedAt:
          record.changed_at ?? null,
        oldValues:
          record.old_values ?? null,
        newValues:
          record.new_values ?? null,
      }),
    )
    .digest("hex");
}

function importedSettingsRecord(
  source,
  userId,
  {
    preserveHomeLocation = false,
    currentHomeLocation = null,
  } = {},
) {
  const record = {
    ...source,
    user_id: userId,
  };

  if (
    preserveHomeLocation &&
    record.settings &&
    typeof record.settings ===
      "object"
  ) {
    record.settings = {
      ...record.settings,
    };

    if (currentHomeLocation) {
      record.settings.homeLocation =
        currentHomeLocation;
    } else {
      delete record.settings.homeLocation;
    }
  }

  return record;
}

async function currentHomeLocation(
  client,
  userId,
) {
  const result = await client.query(
    `
      SELECT settings -> 'homeLocation'
        AS home_location
      FROM user_settings
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return (
    result.rows[0]?.home_location ||
    null
  );
}

function createImportResult() {
  return {
    users: {
      created: 0,
      updated: 0,
    },
    settings: 0,
    vehicles: 0,
    tags: 0,
    trips: 0,
    trackPoints: 0,
    tripTags: 0,
    tripChangeLog: 0,
    appSettings: 0,
    warnings: [],
  };
}

async function importOwnedData(
  client,
  targetUserId,
  data,
  {
    bundleId,
    preserveHomeLocation = false,
  } = {},
) {
  const result = createImportResult();
  const source =
    ensureObject(data, "data");

  const vehicleRecords =
    ensureArray(
      source.vehicles || [],
      "data.vehicles",
    );

  const tagRecords =
    ensureArray(
      source.tags || [],
      "data.tags",
    );

  const tripRecords =
    ensureArray(
      source.trips || [],
      "data.trips",
    );

  const pointRecords =
    ensureArray(
      source.trackPoints || [],
      "data.trackPoints",
    );

  const tripTagRecords =
    ensureArray(
      source.tripTags || [],
      "data.tripTags",
    );

  const changeRecords =
    ensureArray(
      source.tripChangeLog || [],
      "data.tripChangeLog",
    );

  const vehicleIds = new Map();
  const tagIds = new Map();
  const tripIds = new Map();

  const importedDefaultVehicle =
    vehicleRecords.find(
      (record) =>
        record?.is_default,
    );

  if (importedDefaultVehicle) {
    await client.query(
      `
        UPDATE vehicles
        SET is_default = false
        WHERE user_id = $1
      `,
      [targetUserId],
    );
  }

  for (
    const vehicle of
    vehicleRecords
  ) {
    const sourceVehicle =
      ensureObject(
        vehicle,
        "Fahrzeug",
      );

    const targetId =
      await resolveVehicleId(
        client,
        sourceVehicle,
        targetUserId,
      );

    if (sourceVehicle.id) {
      vehicleIds.set(
        String(sourceVehicle.id),
        targetId,
      );
    }

    await upsertRecord(
      client,
      DATA_TABLES.vehicles,
      {
        ...sourceVehicle,
        id: targetId,
        user_id: targetUserId,
        is_default: false,
      },
      {
        conflictColumns: ["id"],
      },
    );

    result.vehicles += 1;
  }

  if (importedDefaultVehicle) {
    const targetDefaultId =
      vehicleIds.get(
        String(
          importedDefaultVehicle.id,
        ),
      );

    if (targetDefaultId) {
      await client.query(
        `
          UPDATE vehicles
          SET is_default = true
          WHERE id = $1
            AND user_id = $2
        `,
        [
          targetDefaultId,
          targetUserId,
        ],
      );
    }
  }

  for (const tag of tagRecords) {
    const sourceTag =
      ensureObject(tag, "Tag");

    const targetId =
      await resolveTagId(
        client,
        sourceTag,
        targetUserId,
      );

    if (sourceTag.id) {
      tagIds.set(
        String(sourceTag.id),
        targetId,
      );
    }

    await upsertRecord(
      client,
      DATA_TABLES.tags,
      {
        ...sourceTag,
        id: targetId,
        user_id: targetUserId,
      },
      {
        conflictColumns: ["id"],
      },
    );

    result.tags += 1;
  }

  for (const trip of tripRecords) {
    const sourceTrip =
      ensureObject(trip, "Fahrt");

    const mappedVehicleId =
      vehicleIds.get(
        String(
          sourceTrip.vehicle_id ||
            "",
        ),
      );

    if (!mappedVehicleId) {
      result.warnings.push(
        `Fahrt ${
          sourceTrip.id || "ohne ID"
        } wurde übersprungen, weil das zugehörige Fahrzeug fehlt.`,
      );
      continue;
    }

    const targetId =
      await resolveTripId(
        client,
        sourceTrip.id,
        targetUserId,
      );

    if (sourceTrip.id) {
      tripIds.set(
        String(sourceTrip.id),
        targetId,
      );
    }

    await upsertRecord(
      client,
      DATA_TABLES.trips,
      {
        ...sourceTrip,
        id: targetId,
        user_id: targetUserId,
        vehicle_id:
          mappedVehicleId,
      },
      {
        conflictColumns: ["id"],
      },
    );

    result.trips += 1;
  }

  for (
    const point of pointRecords
  ) {
    const sourcePoint =
      ensureObject(
        point,
        "GPS-Punkt",
      );

    const targetTripId =
      tripIds.get(
        String(
          sourcePoint.trip_id || "",
        ),
      );

    if (!targetTripId) {
      continue;
    }

    await upsertRecord(
      client,
      DATA_TABLES.trackPoints,
      {
        ...sourcePoint,
        trip_id: targetTripId,
      },
      {
        conflictColumns: [
          "trip_id",
          "sequence_number",
        ],
        excludeColumns: ["id"],
      },
    );

    result.trackPoints += 1;
  }

  for (
    const tripTag of
    tripTagRecords
  ) {
    const sourceTripTag =
      ensureObject(
        tripTag,
        "Fahrt-Tag-Zuordnung",
      );

    const targetTripId =
      tripIds.get(
        String(
          sourceTripTag.trip_id ||
            "",
        ),
      );

    const targetTagId =
      tagIds.get(
        String(
          sourceTripTag.tag_id ||
            "",
        ),
      );

    if (
      !targetTripId ||
      !targetTagId
    ) {
      continue;
    }

    await upsertRecord(
      client,
      DATA_TABLES.tripTags,
      {
        ...sourceTripTag,
        user_id: targetUserId,
        trip_id: targetTripId,
        tag_id: targetTagId,
      },
      {
        conflictColumns: [
          "trip_id",
          "tag_id",
        ],
      },
    );

    result.tripTags += 1;
  }

  if (
    changeRecords.length > 0 &&
    (await tableExists(
      client,
      DATA_TABLES.tripChangeLog,
    ))
  ) {
    for (
      const change of
      changeRecords
    ) {
      const sourceChange =
        ensureObject(
          change,
          "Fahrtänderung",
        );

      const targetTripId =
        tripIds.get(
          String(
            sourceChange.trip_id ||
              "",
          ),
        );

      if (!targetTripId) {
        continue;
      }

      await upsertRecord(
        client,
        DATA_TABLES.tripChangeLog,
        {
          ...sourceChange,
          user_id: targetUserId,
          trip_id: targetTripId,
          import_key:
            changeImportKey(
              bundleId,
              sourceChange,
            ),
        },
        {
          conflictColumns: [
            "user_id",
            "import_key",
          ],
          excludeColumns: ["id"],
        },
      );

      result.tripChangeLog += 1;
    }
  }

  const settingsRecords =
    ensureArray(
      source.userSettings || [],
      "data.userSettings",
    );

  const ownSettings =
    settingsRecords[0];

  if (ownSettings) {
    const preserved =
      preserveHomeLocation
        ? await currentHomeLocation(
            client,
            targetUserId,
          )
        : null;

    await upsertRecord(
      client,
      DATA_TABLES.userSettings,
      importedSettingsRecord(
        ownSettings,
        targetUserId,
        {
          preserveHomeLocation,
          currentHomeLocation:
            preserved,
        },
      ),
      {
        conflictColumns: [
          "user_id",
        ],
      },
    );

    result.settings += 1;
  }

  return result;
}

async function updateOwnProfile(
  client,
  userId,
  owner,
) {
  const profile =
    ensureObject(owner, "owner");

  const values = {
    display_name:
      profile.display_name,
    first_name:
      profile.first_name,
    last_name:
      profile.last_name,
    locale: profile.locale,
    timezone: profile.timezone,
    theme_mode:
      profile.theme_mode,
  };

  const available =
    await getWritableColumns(
      client,
      "users",
    );

  const fields =
    Object.entries(values).filter(
      ([column, value]) =>
        available.includes(column) &&
        value !== undefined &&
        value !== null,
    );

  if (fields.length === 0) {
    return;
  }

  const setSql = fields
    .map(
      ([column], index) =>
        `${quoteIdentifier(
          column,
        )} = $${index + 2}`,
    )
    .join(", ");

  await client.query(
    `
      UPDATE users
      SET ${setSql}
      WHERE id = $1
    `,
    [
      userId,
      ...fields.map(
        ([, value]) => value,
      ),
    ],
  );
}

async function uniqueUsername(
  client,
  preferred,
) {
  const base =
    normalizedUsername(preferred)
      .replace(
        /[^a-z0-9._-]+/g,
        "-",
      )
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) ||
    "import-user";

  for (
    let index = 0;
    index < 10_000;
    index += 1
  ) {
    const candidate =
      index === 0
        ? base
        : `${base}-${index}`;

    const result =
      await client.query(
        `
          SELECT 1
          FROM users
          WHERE lower(username) =
            lower($1)
          LIMIT 1
        `,
        [candidate],
      );

    if (result.rowCount === 0) {
      return candidate;
    }
  }

  throw conflict(
    "USERNAME_GENERATION_FAILED",
    "Es konnte kein freier Anmeldename für den Import erzeugt werden.",
  );
}

async function resolveSystemUser(
  client,
  sourceUser,
  currentAdminUserId,
) {
  const source =
    ensureObject(
      sourceUser,
      "Benutzer",
    );

  const sourceId =
    normalizedUuid(source.id);

  let existing = null;

  if (sourceId) {
    const byId = await client.query(
      `
        SELECT *
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [sourceId],
    );

    existing =
      byId.rows[0] || null;
  }

  if (
    !existing &&
    source.email
  ) {
    const byEmail =
      await client.query(
        `
          SELECT *
          FROM users
          WHERE lower(email) =
            lower($1)
          LIMIT 1
        `,
        [source.email],
      );

    existing =
      byEmail.rows[0] || null;
  }

  if (existing) {
    const protectedSelf =
      existing.id ===
      currentAdminUserId;

    const available =
      await getWritableColumns(
        client,
        "users",
      );

    const candidates = {
      email: source.email,
      username:
        source.username,
      display_name:
        source.display_name,
      first_name:
        source.first_name,
      last_name:
        source.last_name,
      role: protectedSelf
        ? "admin"
        : source.role,
      status: protectedSelf
        ? "active"
        : source.status,
      locale: source.locale,
      timezone:
        source.timezone,
      theme_mode:
        source.theme_mode,
      deleted_at: protectedSelf
        ? null
        : source.deleted_at,
    };

    const fields =
      Object.entries(candidates)
        .filter(
          ([column, value]) =>
            available.includes(
              column,
            ) &&
            value !== undefined,
        );

    if (fields.length > 0) {
      const setSql = fields
        .map(
          ([column], index) =>
            `${quoteIdentifier(
              column,
            )} = $${index + 2}`,
        )
        .join(", ");

      await client.query(
        `
          UPDATE users
          SET ${setSql}
          WHERE id = $1
        `,
        [
          existing.id,
          ...fields.map(
            ([, value]) =>
              value,
          ),
        ],
      );
    }

    return {
      id: existing.id,
      created: false,
    };
  }

  const targetId =
    sourceId || randomUUID();

  const email =
    normalizedEmail(source.email) ||
    `import-${targetId}@invalid.local`;

  const username =
    await uniqueUsername(
      client,
      source.username ||
        email.split("@")[0],
    );

  const available =
    await getWritableColumns(
      client,
      "users",
    );

  const record = {
    id: targetId,
    email,
    username,
    display_name:
      source.display_name ||
      username,
    first_name:
      source.first_name ?? null,
    last_name:
      source.last_name ?? null,
    password_hash: null,
    role:
      source.role === "admin"
        ? "admin"
        : "user",
    status: "disabled",
    locale:
      source.locale || "de",
    timezone:
      source.timezone ||
      "Europe/Berlin",
    theme_mode:
      source.theme_mode ||
      "system",
    totp_secret_encrypted:
      null,
    totp_enabled: false,
    totp_required: false,
    passkey_enabled: true,
    force_password_change:
      true,
    created_at:
      source.created_at,
    updated_at:
      source.updated_at,
    deleted_at:
      source.deleted_at,
  };

  const columns =
    available.filter(
      (column) =>
        Object.hasOwn(
          record,
          column,
        ) &&
        record[column] !==
          undefined,
    );

  const placeholders =
    columns.map(
      (_column, index) =>
        `$${index + 1}`,
    );

  await client.query(
    `
      INSERT INTO users (
        ${columns
          .map(quoteIdentifier)
          .join(", ")}
      )
      VALUES (
        ${placeholders.join(", ")}
      )
    `,
    columns.map((column) =>
      parameterValue(
        record[column],
      ),
    ),
  );

  return {
    id: targetId,
    created: true,
  };
}

function rowsForUser(
  rows,
  userId,
) {
  return rows.filter(
    (row) =>
      String(row.user_id) ===
      String(userId),
  );
}

function pointsForTrips(
  rows,
  tripIds,
) {
  return rows.filter((row) =>
    tripIds.has(
      String(row.trip_id),
    ),
  );
}

function tripTagsForTrips(
  rows,
  tripIds,
) {
  return rows.filter((row) =>
    tripIds.has(
      String(row.trip_id),
    ),
  );
}

function mergeImportResults(
  target,
  source,
) {
  target.users.created +=
    source.users.created;
  target.users.updated +=
    source.users.updated;
  target.settings += source.settings;
  target.vehicles += source.vehicles;
  target.tags += source.tags;
  target.trips += source.trips;
  target.trackPoints +=
    source.trackPoints;
  target.tripTags +=
    source.tripTags;
  target.tripChangeLog +=
    source.tripChangeLog;
  target.appSettings +=
    source.appSettings;
  target.warnings.push(
    ...source.warnings,
  );

  return target;
}

function baseBundle(kind) {
  return {
    format: "fahrtenbuch-data",
    kind,
    schemaVersion:
      DATA_TRANSFER_SCHEMA_VERSION,
    bundleId: randomUUID(),
    exportedAt:
      new Date().toISOString(),
    applicationVersion:
      config.version,
  };
}

export async function createUserDataBundle(
  client,
  userId,
) {
  const user =
    await fetchUserRecord(
      client,
      userId,
    );

  const [
    userSettings,
    vehicles,
    tags,
    trips,
    trackPoints,
    tripTags,
    tripChangeLog,
  ] = await Promise.all([
    fetchJsonRows(
      client,
      DATA_TABLES.userSettings,
      {
        where: "source_row.user_id = $1",
        parameters: [userId],
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.vehicles,
      {
        where: "source_row.user_id = $1",
        parameters: [userId],
        orderBy:
          "source_row.created_at, source_row.id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.tags,
      {
        where: "source_row.user_id = $1",
        parameters: [userId],
        orderBy:
          "source_row.created_at, source_row.id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.trips,
      {
        where: "source_row.user_id = $1",
        parameters: [userId],
        orderBy:
          "source_row.started_at, source_row.id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.trackPoints,
      {
        where: `
          EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.id =
              source_row.trip_id
              AND t.user_id = $1
          )
        `,
        parameters: [userId],
        orderBy:
          "source_row.trip_id, source_row.sequence_number",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.tripTags,
      {
        where: "source_row.user_id = $1",
        parameters: [userId],
        orderBy:
          "source_row.trip_id, source_row.tag_id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.tripChangeLog,
      {
        where: "source_row.user_id = $1",
        parameters: [userId],
        orderBy:
          "source_row.changed_at, source_row.id",
      },
    ),
  ]);

  return {
    ...baseBundle(USER_DATA_KIND),
    owner: portableOwner(user),
    data: {
      userSettings,
      vehicles,
      tags,
      trips,
      trackPoints,
      tripTags,
      tripChangeLog,
    },
  };
}

export async function createSystemDataBundle(
  client,
) {
  const usersResult =
    await client.query(
      `
        SELECT to_jsonb(u) AS record
        FROM users u
        ORDER BY u.created_at, u.id
      `,
    );

  const [
    userSettings,
    vehicles,
    tags,
    trips,
    trackPoints,
    tripTags,
    tripChangeLog,
    appSettings,
  ] = await Promise.all([
    fetchJsonRows(
      client,
      DATA_TABLES.userSettings,
      {
        orderBy:
          "source_row.user_id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.vehicles,
      {
        orderBy:
          "source_row.user_id, source_row.created_at, source_row.id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.tags,
      {
        orderBy:
          "source_row.user_id, source_row.created_at, source_row.id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.trips,
      {
        orderBy:
          "source_row.user_id, source_row.started_at, source_row.id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.trackPoints,
      {
        orderBy:
          "source_row.trip_id, source_row.sequence_number",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.tripTags,
      {
        orderBy:
          "source_row.user_id, source_row.trip_id, source_row.tag_id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.tripChangeLog,
      {
        orderBy:
          "source_row.user_id, source_row.changed_at, source_row.id",
      },
    ),
    fetchJsonRows(
      client,
      DATA_TABLES.appSettings,
      {
        orderBy:
          "source_row.key",
      },
    ),
  ]);

  return {
    ...baseBundle(
      SYSTEM_DATA_KIND,
    ),
    security: {
      included: false,
      excluded: [
        "password hashes",
        "TOTP secrets",
        "passkeys",
        "refresh sessions",
        "password reset tokens",
        "pairing tokens",
        "device push tokens",
      ],
    },
    users: usersResult.rows.map(
      (row) =>
        cleanUserRecord(
          row.record,
        ),
    ),
    data: {
      userSettings,
      vehicles,
      tags,
      trips,
      trackPoints,
      tripTags,
      tripChangeLog,
      appSettings,
    },
  };
}

export function validateDataBundle(
  bundle,
  expectedKind,
) {
  const input =
    ensureObject(
      bundle,
      "Importdatei",
    );

  if (
    input.format !==
    "fahrtenbuch-data"
  ) {
    throw badRequest(
      "INVALID_DATA_EXPORT",
      "Die Datei ist kein Fahrtenbuch-Datenexport.",
    );
  }

  if (
    input.kind !== expectedKind
  ) {
    throw badRequest(
      "INVALID_DATA_EXPORT_KIND",
      expectedKind ===
        USER_DATA_KIND
        ? "Für diesen Import wird ein persönlicher Datenexport benötigt."
        : "Für diesen Import wird ein systemweiter Datenexport benötigt.",
    );
  }

  if (
    Number(input.schemaVersion) !==
    DATA_TRANSFER_SCHEMA_VERSION
  ) {
    throw badRequest(
      "UNSUPPORTED_DATA_EXPORT_VERSION",
      `Die Exportversion ${input.schemaVersion} wird nicht unterstützt.`,
    );
  }

  if (!input.bundleId) {
    throw badRequest(
      "INVALID_DATA_EXPORT",
      "Der Importdatei fehlt die bundleId.",
    );
  }

  ensureObject(
    input.data,
    "data",
  );

  if (
    expectedKind ===
    USER_DATA_KIND
  ) {
    ensureObject(
      input.owner,
      "owner",
    );
  } else {
    ensureArray(
      input.users,
      "users",
    );
  }

  return input;
}

export async function importUserDataBundle(
  client,
  targetUserId,
  bundle,
) {
  const input =
    validateDataBundle(
      bundle,
      USER_DATA_KIND,
    );

  await updateOwnProfile(
    client,
    targetUserId,
    input.owner,
  );

  const result =
    await importOwnedData(
      client,
      targetUserId,
      input.data,
      {
        bundleId:
          input.bundleId,
      },
    );

  result.users.updated = 1;

  return result;
}

export async function importSystemDataBundle(
  client,
  currentAdminUserId,
  bundle,
  {
    restoreSystemSettings = false,
  } = {},
) {
  const input =
    validateDataBundle(
      bundle,
      SYSTEM_DATA_KIND,
    );

  const result =
    createImportResult();

  const userSettings =
    ensureArray(
      input.data.userSettings || [],
      "data.userSettings",
    );

  const vehicles =
    ensureArray(
      input.data.vehicles || [],
      "data.vehicles",
    );

  const tags =
    ensureArray(
      input.data.tags || [],
      "data.tags",
    );

  const trips =
    ensureArray(
      input.data.trips || [],
      "data.trips",
    );

  const trackPoints =
    ensureArray(
      input.data.trackPoints || [],
      "data.trackPoints",
    );

  const tripTags =
    ensureArray(
      input.data.tripTags || [],
      "data.tripTags",
    );

  const tripChangeLog =
    ensureArray(
      input.data.tripChangeLog || [],
      "data.tripChangeLog",
    );

  for (
    const sourceUser of
    input.users
  ) {
    const source =
      ensureObject(
        sourceUser,
        "Benutzer",
      );

    const mapping =
      await resolveSystemUser(
        client,
        source,
        currentAdminUserId,
      );

    if (mapping.created) {
      result.users.created += 1;
      result.warnings.push(
        `Das importierte Konto ${source.email || source.username || source.id} wurde aus Sicherheitsgründen deaktiviert und besitzt kein importiertes Passwort.`,
      );
    } else {
      result.users.updated += 1;
    }

    const sourceUserId =
      String(source.id || "");

    const sourceTrips =
      rowsForUser(
        trips,
        sourceUserId,
      );

    const sourceTripIds =
      new Set(
        sourceTrips.map((trip) =>
          String(trip.id),
        ),
      );

    const ownedResult =
      await importOwnedData(
        client,
        mapping.id,
        {
          userSettings:
            rowsForUser(
              userSettings,
              sourceUserId,
            ),
          vehicles:
            rowsForUser(
              vehicles,
              sourceUserId,
            ),
          tags:
            rowsForUser(
              tags,
              sourceUserId,
            ),
          trips: sourceTrips,
          trackPoints:
            pointsForTrips(
              trackPoints,
              sourceTripIds,
            ),
          tripTags:
            tripTagsForTrips(
              tripTags,
              sourceTripIds,
            ),
          tripChangeLog:
            rowsForUser(
              tripChangeLog,
              sourceUserId,
            ),
        },
        {
          bundleId:
            input.bundleId,
          preserveHomeLocation:
            !mapping.created,
        },
      );

    mergeImportResults(
      result,
      ownedResult,
    );
  }

  if (
    restoreSystemSettings
  ) {
    const appSettings =
      ensureArray(
        input.data.appSettings || [],
        "data.appSettings",
      );

    for (
      const setting of
      appSettings
    ) {
      const sourceSetting =
        ensureObject(
          setting,
          "Systemeinstellung",
        );

      await upsertRecord(
        client,
        DATA_TABLES.appSettings,
        {
          ...sourceSetting,
          updated_by_user_id:
            currentAdminUserId,
        },
        {
          conflictColumns: ["key"],
        },
      );

      result.appSettings += 1;
    }
  }

  return result;
}
