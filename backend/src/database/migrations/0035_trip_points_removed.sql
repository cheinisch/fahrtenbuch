-- Einzelne GPS-Punkte einer Fahrt entfernen (Ausreißer) wird in der Fahrthistorie
-- protokolliert. Dabei die Liste der Ereignistypen vervollständigen: 0019/0020 hatten
-- ROUTE_CORRECTED und AUTO_CLASSIFIED (aus 0012) versehentlich wieder entfernt, wodurch
-- die manuelle Routenkorrektur beim Schreiben der Historie scheiterte.
ALTER TABLE trip_history DROP CONSTRAINT IF EXISTS trip_history_event_type_check;
ALTER TABLE trip_history ADD CONSTRAINT trip_history_event_type_check CHECK (
  event_type IN (
    'CREATED','UPDATED','CLASSIFIED','ARCHIVED','DELETED',
    'TAG_ADDED','TAG_REMOVED','MAP_MATCHED','BASELINE',
    'TRIP_SPLIT','TRIP_MERGED','ROUTE_CORRECTED','AUTO_CLASSIFIED',
    'TRACK_DUPLICATE','TRACK_RECONCILED','DRIVER_ASSIGNED',
    'POINTS_REMOVED'
  )
);
