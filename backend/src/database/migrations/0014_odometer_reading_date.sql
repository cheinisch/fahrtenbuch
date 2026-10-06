-- Exaktes Ablesedatum für monatliche Kilometerstände.
-- reading_month bleibt als Monatszuordnung und Unique-Key erhalten.

ALTER TABLE vehicle_odometer_readings
  ADD COLUMN IF NOT EXISTS reading_date date;

UPDATE vehicle_odometer_readings
SET reading_date = reading_month
WHERE reading_date IS NULL;

ALTER TABLE vehicle_odometer_readings
  ALTER COLUMN reading_date SET NOT NULL;

ALTER TABLE vehicle_odometer_readings
  DROP CONSTRAINT IF EXISTS vehicle_odometer_readings_date_in_month;

ALTER TABLE vehicle_odometer_readings
  ADD CONSTRAINT vehicle_odometer_readings_date_in_month
  CHECK (date_trunc('month', reading_date)::date = reading_month);

CREATE INDEX IF NOT EXISTS vehicle_odometer_readings_vehicle_date_idx
  ON vehicle_odometer_readings (user_id, vehicle_id, reading_date DESC);
