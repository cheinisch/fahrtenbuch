-- Fahrtenbuch – verbindliche Zuordnung von Fahrzeugen, Kategorien,
-- Tags und GPS-Punkten
-- Version: 0007

BEGIN;

-- Vor dem Schärfen der Constraints werden inkonsistente Altdaten bewusst
-- nicht automatisch gelöscht. Die Migration bricht mit einer verständlichen
-- Meldung ab, damit keine Fahrtenbuchdaten unbemerkt verloren gehen.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM track_points p
    LEFT JOIN trips t ON t.id = p.trip_id
    WHERE p.trip_id IS NULL OR t.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'track_points enthält GPS-Punkte ohne gültige Fahrt.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM trips t
    LEFT JOIN vehicles v
      ON v.id = t.vehicle_id
      AND v.user_id = t.user_id
    WHERE t.vehicle_id IS NULL OR v.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'trips enthält Fahrten ohne gültiges Fahrzeug desselben Benutzers.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM trips
    WHERE type IS NULL
  ) THEN
    RAISE EXCEPTION
      'trips enthält Fahrten ohne Kategorie.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM trip_tags tt
    LEFT JOIN trips t
      ON t.id = tt.trip_id
      AND t.user_id = tt.user_id
    LEFT JOIN tags tag
      ON tag.id = tt.tag_id
      AND tag.user_id = tt.user_id
    WHERE t.id IS NULL OR tag.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'trip_tags enthält ungültige Fahrt-Tag-Zuordnungen.';
  END IF;
END
$$;

ALTER TABLE trips
  ALTER COLUMN vehicle_id SET NOT NULL,
  ALTER COLUMN type SET NOT NULL;

ALTER TABLE track_points
  ALTER COLUMN trip_id SET NOT NULL;

-- Sicherstellen, dass der GPS-Fremdschlüssel mit ON DELETE CASCADE existiert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    WHERE r.relname = 'track_points'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid)
        LIKE 'FOREIGN KEY (trip_id) REFERENCES trips(id)%'
  ) THEN
    ALTER TABLE track_points
      ADD CONSTRAINT track_points_trip_fk
      FOREIGN KEY (trip_id)
      REFERENCES trips(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

COMMENT ON COLUMN trips.type IS
  'Pflichtkategorie der Fahrt: business, private, commute oder unclassified.';

COMMENT ON COLUMN trips.vehicle_id IS
  'Pflichtfahrzeug der Fahrt; muss demselben Benutzer gehören.';

COMMENT ON COLUMN track_points.trip_id IS
  'Pflichtzuordnung jedes GPS-Punkts zu genau einer Fahrt.';

COMMENT ON TABLE trip_tags IS
  'Mehrfachzuordnung: Eine Fahrt kann 0 bis n Tags desselben Benutzers besitzen.';

COMMIT;
