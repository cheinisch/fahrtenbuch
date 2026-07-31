-- Fahrtenbuch: steuerorientierter PDF-Export und Kilometerstände
-- Idempotent und für bestehende Installationen geeignet.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS start_odometer_meters bigint,
  ADD COLUMN IF NOT EXISTS end_odometer_meters bigint;

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_start_odometer_nonnegative;
ALTER TABLE trips
  ADD CONSTRAINT trips_start_odometer_nonnegative
  CHECK (
    start_odometer_meters IS NULL
    OR start_odometer_meters >= 0
  );

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_end_odometer_nonnegative;
ALTER TABLE trips
  ADD CONSTRAINT trips_end_odometer_nonnegative
  CHECK (
    end_odometer_meters IS NULL
    OR end_odometer_meters >= 0
  );

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_odometer_sequence;
ALTER TABLE trips
  ADD CONSTRAINT trips_odometer_sequence
  CHECK (
    start_odometer_meters IS NULL
    OR end_odometer_meters IS NULL
    OR end_odometer_meters >= start_odometer_meters
  );

CREATE INDEX IF NOT EXISTS trips_export_period_idx
  ON trips (user_id, started_at, vehicle_id, type)
  WHERE archived_at IS NULL
    AND status = 'completed';

-- Änderungen an Fahrten werden als eigener Datensatz dokumentiert.
-- Dies ersetzt keine steuerliche Einzelfallprüfung, macht spätere
-- Änderungen aber technisch nachvollziehbar.
CREATE TABLE IF NOT EXISTS trip_change_log (
  id bigserial PRIMARY KEY,
  trip_id uuid NOT NULL,
  user_id uuid NOT NULL,
  operation text NOT NULL
    CHECK (operation IN ('UPDATE', 'DELETE')),
  old_values jsonb NOT NULL,
  new_values jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_change_log_trip_idx
  ON trip_change_log (trip_id, changed_at);

CREATE INDEX IF NOT EXISTS trip_change_log_user_idx
  ON trip_change_log (user_id, changed_at);

CREATE OR REPLACE FUNCTION log_trip_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
      INSERT INTO trip_change_log (
        trip_id,
        user_id,
        operation,
        old_values,
        new_values
      )
      VALUES (
        OLD.id,
        OLD.user_id,
        'UPDATE',
        to_jsonb(OLD),
        to_jsonb(NEW)
      );
    END IF;

    RETURN NEW;
  END IF;

  INSERT INTO trip_change_log (
    trip_id,
    user_id,
    operation,
    old_values,
    new_values
  )
  VALUES (
    OLD.id,
    OLD.user_id,
    'DELETE',
    to_jsonb(OLD),
    NULL
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trips_change_log ON trips;
CREATE TRIGGER trips_change_log
AFTER UPDATE OR DELETE ON trips
FOR EACH ROW
EXECUTE FUNCTION log_trip_change();
