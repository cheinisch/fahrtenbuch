-- Map-Matching: Ergebnis je Fahrt in eigener Tabelle, damit die Routengeometrie
-- nicht bei jeder Änderung über die Audit-Trigger in trip_history landet.
-- Die GPS-Rohpunkte (track_points) bleiben unverändert.
CREATE TABLE IF NOT EXISTS trip_map_matches (
  trip_id uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- applied: Distanz übernommen · rejected: Ergebnis unplausibel · failed: Dienst konnte nicht matchen
  status text NOT NULL CHECK (status IN ('applied', 'rejected', 'failed')),
  provider text NOT NULL CHECK (provider IN ('valhalla', 'osrm', 'atlas')),
  message text,
  point_count integer NOT NULL DEFAULT 0 CHECK (point_count >= 0),
  raw_distance_meters bigint CHECK (raw_distance_meters IS NULL OR raw_distance_meters >= 0),
  matched_distance_meters bigint CHECK (matched_distance_meters IS NULL OR matched_distance_meters >= 0),
  confidence double precision,
  -- [[lat, lon], …] der auf das Straßennetz gelegten Route
  route jsonb,
  matched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_map_matches_user_idx
  ON trip_map_matches (user_id, matched_at);
