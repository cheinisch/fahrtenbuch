-- Monatliche Kilometerstände je Fahrzeug für Plausibilisierung und Statistik.

CREATE TABLE IF NOT EXISTS vehicle_odometer_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reading_month date NOT NULL,
  odometer_meters bigint NOT NULL CHECK (odometer_meters >= 0),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'vehicle_api', 'import')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_odometer_readings_month_start
    CHECK (reading_month = date_trunc('month', reading_month)::date),
  CONSTRAINT vehicle_odometer_readings_unique_month
    UNIQUE (user_id, vehicle_id, reading_month)
);

CREATE INDEX IF NOT EXISTS vehicle_odometer_readings_vehicle_month_idx
  ON vehicle_odometer_readings (user_id, vehicle_id, reading_month DESC);
