-- Fahrtenbuch API 1.0 – ergänzende Spalten und Standardkonfiguration
-- Diese Migration ist absichtlich idempotent und kann auf dem bestehenden
-- 0001-Schema angewendet werden.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS vin text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS devices_external_id_unique_per_user
  ON devices (user_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS devices_external_id_lookup_idx
  ON devices (external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trips_user_status_started_idx
  ON trips (user_id, status, started_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS track_points_trip_time_coordinate_idx
  ON track_points (trip_id, recorded_at, lat, lon);

CREATE TABLE IF NOT EXISTS backup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_user_id uuid
    REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  file_name text,
  file_size_bytes bigint,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS backup_jobs_created_idx
  ON backup_jobs (created_at DESC);

INSERT INTO app_settings (key, value, is_public)
VALUES
  (
    'services.map',
    '{
      "provider":"osm",
      "type":"raster",
      "tileUrl":"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      "styleUrl":null,
      "attribution":"© OpenStreetMap-Mitwirkende",
      "minZoom":0,
      "maxZoom":19,
      "tileSize":256
    }'::jsonb,
    true
  ),
  (
    'services.photon',
    '{
      "provider":"public",
      "baseUrl":"https://photon.komoot.io",
      "timeoutMs":10000
    }'::jsonb,
    false
  ),
  (
    'services.overpass',
    '{
      "provider":"public",
      "interpreterUrl":"https://overpass-api.de/api/interpreter",
      "timeoutMs":30000,
      "searchRadiusMeters":2500,
      "maxResults":50
    }'::jsonb,
    false
  )
ON CONFLICT (key) DO NOTHING;
