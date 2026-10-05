-- Gespeicherte Orte und zusätzliche Audit-Ereignisse.
CREATE TABLE saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  address text,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_meters integer CHECK (radius_meters IS NULL OR radius_meters BETWEEN 25 AND 5000),
  suggested_type trip_type,
  purpose text,
  contact text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX saved_places_user_name_idx ON saved_places(user_id, lower(name));
CREATE TRIGGER saved_places_set_updated_at BEFORE UPDATE ON saved_places
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE trip_history DROP CONSTRAINT IF EXISTS trip_history_event_type_check;
ALTER TABLE trip_history ADD CONSTRAINT trip_history_event_type_check CHECK (
  event_type IN (
    'CREATED','UPDATED','CLASSIFIED','ARCHIVED','DELETED','TAG_ADDED','TAG_REMOVED',
    'MAP_MATCHED','BASELINE','TRIP_SPLIT','TRIP_MERGED','ROUTE_CORRECTED',
    'AUTO_CLASSIFIED'
  )
);
