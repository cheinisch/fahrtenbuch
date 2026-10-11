-- Actual reading time, distinct from the timestamp of database entry.
-- Historical readings have unknown clock time; do not infer it from recorded_at.
ALTER TABLE vehicle_odometer_readings ADD COLUMN IF NOT EXISTS reading_at timestamptz;
CREATE INDEX IF NOT EXISTS vehicle_odometer_readings_reading_at_idx
  ON vehicle_odometer_readings (user_id, vehicle_id, reading_at DESC);
