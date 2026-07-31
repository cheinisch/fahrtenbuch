BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS user_preferences_set_updated_at ON user_preferences;
CREATE TRIGGER user_preferences_set_updated_at
BEFORE UPDATE ON user_preferences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS totp_credentials_set_updated_at ON totp_credentials;
CREATE TRIGGER totp_credentials_set_updated_at
BEFORE UPDATE ON totp_credentials
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS vehicles_set_updated_at ON vehicles;
CREATE TRIGGER vehicles_set_updated_at
BEFORE UPDATE ON vehicles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trips_set_updated_at ON trips;
CREATE TRIGGER trips_set_updated_at
BEFORE UPDATE ON trips
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trip_comments_set_updated_at ON trip_comments;
CREATE TRIGGER trip_comments_set_updated_at
BEFORE UPDATE ON trip_comments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS external_services_set_updated_at ON external_services;
CREATE TRIGGER external_services_set_updated_at
BEFORE UPDATE ON external_services
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION enforce_trip_vehicle_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM vehicles
     WHERE id = NEW.vehicle_id
       AND user_id = NEW.user_id
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Vehicle does not belong to trip user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_enforce_vehicle_owner ON trips;
CREATE TRIGGER trips_enforce_vehicle_owner
BEFORE INSERT OR UPDATE OF vehicle_id, user_id ON trips
FOR EACH ROW EXECUTE FUNCTION enforce_trip_vehicle_owner();

CREATE OR REPLACE FUNCTION update_vehicle_odometer_from_trip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.end_odometer_km IS NOT NULL THEN
    UPDATE vehicles
       SET current_odometer_km = GREATEST(current_odometer_km, NEW.end_odometer_km),
           updated_at = now()
     WHERE id = NEW.vehicle_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_update_vehicle_odometer ON trips;
CREATE TRIGGER trips_update_vehicle_odometer
AFTER INSERT OR UPDATE OF status, end_odometer_km ON trips
FOR EACH ROW EXECUTE FUNCTION update_vehicle_odometer_from_trip();

COMMIT;
