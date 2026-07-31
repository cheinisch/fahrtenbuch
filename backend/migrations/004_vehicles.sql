BEGIN;

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  manufacturer text,
  model text,
  license_plate citext,
  vin text,
  initial_odometer_km numeric(12,2) NOT NULL DEFAULT 0 CHECK (initial_odometer_km >= 0),
  current_odometer_km numeric(12,2) NOT NULL DEFAULT 0 CHECK (current_odometer_km >= 0),
  bluetooth_mac macaddr,
  color text,
  fuel_type text,
  is_default boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (current_odometer_km >= initial_odometer_km)
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_bluetooth_mac_unique
  ON vehicles(bluetooth_mac) WHERE bluetooth_mac IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_user_plate_unique
  ON vehicles(user_id, license_plate) WHERE license_plate IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_one_default_per_user
  ON vehicles(user_id) WHERE is_default = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS vehicles_user_idx ON vehicles(user_id);
CREATE INDEX IF NOT EXISTS vehicles_active_idx ON vehicles(user_id, is_archived, deleted_at);

CREATE TABLE IF NOT EXISTS odometer_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  odometer_km numeric(12,2) NOT NULL CHECK (odometer_km >= 0),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','trip','import','api')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS odometer_entries_vehicle_time_idx
  ON odometer_entries(vehicle_id, recorded_at DESC);

COMMIT;
