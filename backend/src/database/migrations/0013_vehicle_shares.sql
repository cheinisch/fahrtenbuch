-- Fahrzeugfreigaben: Ein Fahrzeug bleibt Eigentum eines Benutzers,
-- kann aber von anderen aktiven Benutzern für eigene Fahrten genutzt werden.

CREATE TABLE vehicle_shares (
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, user_id)
);

CREATE INDEX vehicle_shares_user_idx
  ON vehicle_shares (user_id, created_at DESC);

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_vehicle_owner_fk;

ALTER TABLE trips
  ADD CONSTRAINT trips_vehicle_fk
  FOREIGN KEY (vehicle_id)
  REFERENCES vehicles(id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION enforce_trip_vehicle_access()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF NOT EXISTS (
      SELECT 1
      FROM vehicles v
      WHERE v.id = NEW.vehicle_id
        AND v.archived_at IS NULL
        AND (
          v.user_id = NEW.user_id
          OR EXISTS (
            SELECT 1
            FROM vehicle_shares vs
            WHERE vs.vehicle_id = v.id
              AND vs.user_id = NEW.user_id
          )
        )
    ) THEN
      RAISE EXCEPTION 'Benutzer hat keinen Zugriff auf das Fahrzeug.'
        USING ERRCODE = '23503',
              CONSTRAINT = 'trips_vehicle_access';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_vehicle_access ON trips;
CREATE TRIGGER trips_vehicle_access
BEFORE INSERT OR UPDATE OF vehicle_id, user_id ON trips
FOR EACH ROW
EXECUTE FUNCTION enforce_trip_vehicle_access();
