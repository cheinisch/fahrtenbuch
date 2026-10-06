ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'canonical',
  ADD COLUMN IF NOT EXISTS canonical_trip_id uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_reconciliation_status_check;
ALTER TABLE trips ADD CONSTRAINT trips_reconciliation_status_check
  CHECK (reconciliation_status IN ('canonical','duplicate','merged_source'));

CREATE INDEX IF NOT EXISTS trips_vehicle_reconciliation_idx
  ON trips(vehicle_id, started_at, ended_at);

ALTER TABLE trip_history DROP CONSTRAINT IF EXISTS trip_history_event_type_check;
ALTER TABLE trip_history ADD CONSTRAINT trip_history_event_type_check CHECK (
  event_type IN (
    'CREATED','UPDATED','CLASSIFIED','ARCHIVED','DELETED',
    'TAG_ADDED','TAG_REMOVED','MAP_MATCHED','BASELINE',
    'TRIP_SPLIT','TRIP_MERGED','TRACK_DUPLICATE','TRACK_RECONCILED'
  )
);
