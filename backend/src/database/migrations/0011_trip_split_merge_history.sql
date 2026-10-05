-- Audit-Ereignisse für das Teilen und Zusammenführen von Fahrten.
ALTER TABLE trip_history
  DROP CONSTRAINT IF EXISTS trip_history_event_type_check;

ALTER TABLE trip_history
  ADD CONSTRAINT trip_history_event_type_check CHECK (
    event_type IN (
      'CREATED','UPDATED','CLASSIFIED','ARCHIVED','DELETED',
      'TAG_ADDED','TAG_REMOVED','MAP_MATCHED','BASELINE',
      'TRIP_SPLIT','TRIP_MERGED'
    )
  );
