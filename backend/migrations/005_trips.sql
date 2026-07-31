BEGIN;

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  status trip_status NOT NULL DEFAULT 'draft',
  purpose trip_purpose NOT NULL DEFAULT 'private',
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  start_latitude numeric(9,6),
  start_longitude numeric(9,6),
  end_latitude numeric(9,6),
  end_longitude numeric(9,6),
  start_address text,
  end_address text,
  start_odometer_km numeric(12,2),
  end_odometer_km numeric(12,2),
  distance_km numeric(12,3) NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
  title text,
  purpose_description text,
  notes text,
  route_geometry jsonb,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','tracking','import','api')),
  is_locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (start_latitude IS NULL OR start_latitude BETWEEN -90 AND 90),
  CHECK (end_latitude IS NULL OR end_latitude BETWEEN -90 AND 90),
  CHECK (start_longitude IS NULL OR start_longitude BETWEEN -180 AND 180),
  CHECK (end_longitude IS NULL OR end_longitude BETWEEN -180 AND 180),
  CHECK (start_odometer_km IS NULL OR start_odometer_km >= 0),
  CHECK (end_odometer_km IS NULL OR end_odometer_km >= 0),
  CHECK (
    start_odometer_km IS NULL OR end_odometer_km IS NULL
    OR end_odometer_km >= start_odometer_km
  )
);

CREATE INDEX IF NOT EXISTS trips_user_started_idx ON trips(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS trips_vehicle_started_idx ON trips(vehicle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS trips_status_idx ON trips(status);
CREATE INDEX IF NOT EXISTS trips_purpose_idx ON trips(user_id, purpose);
CREATE INDEX IF NOT EXISTS trips_active_idx ON trips(user_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS trip_points (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  altitude_m numeric(9,2),
  accuracy_m numeric(9,2) CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  speed_kmh numeric(9,2) CHECK (speed_kmh IS NULL OR speed_kmh >= 0),
  heading_deg numeric(6,2) CHECK (heading_deg IS NULL OR heading_deg BETWEEN 0 AND 360),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trip_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS trip_points_trip_time_idx ON trip_points(trip_id, recorded_at);

CREATE TABLE IF NOT EXISTS trip_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  latitude numeric(9,6),
  longitude numeric(9,6),
  address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS trip_stops_trip_idx ON trip_stops(trip_id, started_at);

CREATE TABLE IF NOT EXISTS trip_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_corrections_trip_idx ON trip_corrections(trip_id, created_at DESC);

COMMIT;
