-- Persönliche Verbindung zu einer Dawarich-Instanz: damit lassen sich Lücken in
-- aufgezeichneten Fahrten (z. B. App vom System beendet) mit den Standortdaten
-- aus Dawarich füllen. Der API-Key liegt verschlüsselt (security/encryption.js).
CREATE TABLE IF NOT EXISTS user_dawarich_connections (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url text NOT NULL,
  api_key_encrypted text NOT NULL,
  -- letzte vier Zeichen zur Anzeige im Profil, der Schlüssel selbst geht nie zurück
  api_key_hint text,
  dawarich_email text,
  dawarich_version text,
  verified_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Neuer Historientyp für Punkte, die aus Dawarich ergänzt wurden
ALTER TABLE trip_history DROP CONSTRAINT IF EXISTS trip_history_event_type_check;
ALTER TABLE trip_history ADD CONSTRAINT trip_history_event_type_check CHECK (
  event_type IN (
    'CREATED','UPDATED','CLASSIFIED','ARCHIVED','DELETED',
    'TAG_ADDED','TAG_REMOVED','MAP_MATCHED','BASELINE',
    'TRIP_SPLIT','TRIP_MERGED','ROUTE_CORRECTED','AUTO_CLASSIFIED',
    'TRACK_DUPLICATE','TRACK_RECONCILED','DRIVER_ASSIGNED',
    'POINTS_REMOVED','POINTS_IMPORTED'
  )
);
