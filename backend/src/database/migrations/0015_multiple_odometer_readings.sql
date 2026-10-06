-- Mehrere Kilometerstandsablesungen pro Monat erlauben.
-- Ein Messwert bleibt pro Fahrzeug und konkretem Kalendertag eindeutig.

ALTER TABLE vehicle_odometer_readings
  DROP CONSTRAINT IF EXISTS vehicle_odometer_readings_unique_month;

ALTER TABLE vehicle_odometer_readings
  ADD CONSTRAINT vehicle_odometer_readings_unique_date
  UNIQUE (user_id, vehicle_id, reading_date);

CREATE INDEX IF NOT EXISTS vehicle_odometer_readings_month_idx
  ON vehicle_odometer_readings (user_id, vehicle_id, reading_month, reading_date);
