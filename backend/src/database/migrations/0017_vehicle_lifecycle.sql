ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS deregistered_at timestamptz;

CREATE TABLE IF NOT EXISTS vehicle_ownership_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS vehicle_ownership_periods_vehicle_dates_idx
  ON vehicle_ownership_periods (vehicle_id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS vehicle_ownership_periods_user_dates_idx
  ON vehicle_ownership_periods (user_id, valid_from, valid_to);

INSERT INTO vehicle_ownership_periods (vehicle_id, user_id, valid_from, valid_to, created_by_user_id)
SELECT v.id, v.user_id, v.created_at, v.deregistered_at, v.user_id
FROM vehicles v
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_ownership_periods p WHERE p.vehicle_id = v.id
);

CREATE OR REPLACE FUNCTION prevent_overlapping_vehicle_ownership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM vehicle_ownership_periods p
    WHERE p.vehicle_id = NEW.vehicle_id
      AND p.id <> NEW.id
      AND tstzrange(p.valid_from, COALESCE(p.valid_to, 'infinity'::timestamptz), '[)')
          && tstzrange(NEW.valid_from, COALESCE(NEW.valid_to, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'vehicle ownership periods must not overlap' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_ownership_periods_no_overlap ON vehicle_ownership_periods;
CREATE TRIGGER vehicle_ownership_periods_no_overlap
BEFORE INSERT OR UPDATE ON vehicle_ownership_periods
FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_vehicle_ownership();
