CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  login_name text UNIQUE NOT NULL,
  display_name text NOT NULL,
  first_name text,
  last_name text,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  locale text NOT NULL DEFAULT 'de-DE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  manufacturer text,
  model text,
  license_plate text,
  bluetooth_mac text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_bluetooth_mac_unique
  ON vehicles(bluetooth_mac) WHERE bluetooth_mac IS NOT NULL;

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  start_address text,
  end_address text,
  distance_km numeric(10,2) NOT NULL DEFAULT 0,
  purpose text NOT NULL DEFAULT 'private' CHECK (purpose IN ('private','commute','business')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS trip_tags (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(trip_id, tag_id)
);

CREATE TABLE IF NOT EXISTS external_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL,
  name text NOT NULL,
  base_url text NOT NULL,
  internal_only boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
