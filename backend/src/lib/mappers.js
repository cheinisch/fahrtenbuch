export function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    loginName: row.username ?? null,
    username: row.username ?? null,
    displayName: row.display_name ?? null,
    role: row.role,
    status: row.status,
    locale: row.locale || "de",
    timezone: row.timezone || "Europe/Berlin",
    themeMode: row.theme_mode || "system",
    totpEnabled: Boolean(row.totp_enabled),
    forcePasswordChange: Boolean(row.force_password_change),
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDevice(row) {
  return {
    deviceId: row.external_id || row.id,
    id: row.id,
    deviceName: row.device_name ?? null,
    deviceType: row.device_type ?? null,
    platform: row.platform ?? null,
    appVersion: row.app_version ?? null,
    lastUsedAt: row.last_seen_at || row.created_at,
    lastSeenAt: row.last_seen_at ?? null,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? null,
    isCurrent: Boolean(row.is_current),
  };
}

export function mapVehicle(row) {
  return {
    id: row.id,
    name: row.name,
    manufacturer: row.manufacturer ?? null,
    model: row.model ?? null,
    licensePlate: row.license_plate ?? null,
    vin: row.vin ?? null,
    odometerKm:
      row.odometer_meters === null || row.odometer_meters === undefined
        ? null
        : Number(row.odometer_meters) / 1000,
    color: row.color ?? null,
    notes: row.notes ?? null,
    bluetoothMac: row.bluetooth_identifier ?? null,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTag(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

export function mapTrackPoint(row) {
  return {
    id: row.id ?? null,
    tripId: row.trip_id ?? null,
    sequenceNumber:
      row.sequence_number === undefined || row.sequence_number === null
        ? undefined
        : Number(row.sequence_number),
    lat: Number(row.lat),
    lon: Number(row.lon),
    altitude:
      row.altitude_meters === null || row.altitude_meters === undefined
        ? null
        : Number(row.altitude_meters),
    accuracy:
      row.accuracy_meters === null || row.accuracy_meters === undefined
        ? null
        : Number(row.accuracy_meters),
    speed:
      row.speed_mps === null || row.speed_mps === undefined
        ? null
        : Number(row.speed_mps),
    bearing:
      row.bearing_degrees === null || row.bearing_degrees === undefined
        ? null
        : Number(row.bearing_degrees),
    recordedAt: row.recorded_at,
  };
}

export function mapTrip(row) {
  const tags = Array.isArray(row.tags) ? row.tags : [];

  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    vehicleName: row.vehicle_name ?? undefined,
    type: row.type,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    startAddress: row.start_address ?? null,
    endAddress: row.end_address ?? null,
    startLat:
      row.start_lat === null || row.start_lat === undefined
        ? null
        : Number(row.start_lat),
    startLon:
      row.start_lon === null || row.start_lon === undefined
        ? null
        : Number(row.start_lon),
    endLat:
      row.end_lat === null || row.end_lat === undefined
        ? null
        : Number(row.end_lat),
    endLon:
      row.end_lon === null || row.end_lon === undefined
        ? null
        : Number(row.end_lon),
    purpose: row.purpose ?? null,
    contact: row.contact ?? null,
    notes: row.notes ?? null,
    startOdometerKm:
      row.start_odometer_meters === null ||
      row.start_odometer_meters === undefined
        ? null
        : Number(row.start_odometer_meters) / 1000,
    endOdometerKm:
      row.end_odometer_meters === null ||
      row.end_odometer_meters === undefined
        ? null
        : Number(row.end_odometer_meters) / 1000,
    distanceKm:
      row.distance_meters === null || row.distance_meters === undefined
        ? null
        : Number(row.distance_meters) / 1000,
    distanceMeters:
      row.distance_meters === null || row.distance_meters === undefined
        ? null
        : Number(row.distance_meters),
    durationSeconds:
      row.duration_seconds === null || row.duration_seconds === undefined
        ? null
        : Number(row.duration_seconds),
    source: row.source ?? undefined,
    version: row.version === undefined ? undefined : Number(row.version),
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
