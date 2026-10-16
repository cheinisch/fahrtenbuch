-- Fahrt-ID des Endgeräts (beim Start erzeugt) und das aufzeichnende Gerät. Damit kann die
-- App bei einem Sync erkennen, welche noch laufende Server-Aufzeichnung ihre ist, und sie
-- übernehmen, beenden oder verwerfen – statt dauerhaft an 409 TRACKING_ALREADY_ACTIVE zu scheitern.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS client_trip_id uuid;

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES devices(id) ON DELETE SET NULL;

-- Eine Geräte-Fahrt-ID gibt es je Benutzer nur einmal unter den nicht archivierten Fahrten
CREATE UNIQUE INDEX IF NOT EXISTS trips_user_client_trip_id_unique
  ON trips (user_id, client_trip_id)
  WHERE client_trip_id IS NOT NULL AND archived_at IS NULL;
