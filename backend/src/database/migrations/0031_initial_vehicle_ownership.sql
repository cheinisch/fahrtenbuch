-- Erster Besitzzeitraum für jedes Fahrzeug.
--
-- 0017 hat Besitzzeiträume nur für damals vorhandene Fahrzeuge angelegt; später
-- angelegte Fahrzeuge (API, Wiederherstellung) bekamen keinen. Alles, was den
-- Halter zu einem Zeitpunkt prüft – Fahrten freigegebener Fahrer in der
-- Statistik, Leasing-Prognose, Abgleich paralleler Aufzeichnungen,
-- Bluetooth-Prüfung – hat diese Fahrzeuge dadurch nicht dem Besitzer zugeordnet.

-- Nachtragen: ab Anlage des Fahrzeugs bzw. ab der frühesten Fahrt, falls Fahrten
-- (z. B. importierte) älter sind; Ende bei Abmeldung.
INSERT INTO vehicle_ownership_periods (vehicle_id, user_id, valid_from, valid_to, created_by_user_id)
SELECT
  v.id,
  v.user_id,
  least(v.created_at, coalesce(first_trip.started_at, v.created_at)),
  CASE
    WHEN v.deregistered_at > least(v.created_at, coalesce(first_trip.started_at, v.created_at))
      THEN v.deregistered_at
  END,
  v.user_id
FROM vehicles v
LEFT JOIN LATERAL (
  SELECT min(t.started_at) AS started_at
  FROM trips t
  WHERE t.vehicle_id = v.id
) first_trip ON true
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_ownership_periods p WHERE p.vehicle_id = v.id
);

-- Künftig legt die Datenbank den ersten Zeitraum selbst an, egal über welchen
-- Weg das Fahrzeug entsteht. Vorhandene Zeiträume (z. B. aus einer
-- Wiederherstellung) bleiben unangetastet.
CREATE OR REPLACE FUNCTION create_initial_vehicle_ownership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vehicle_ownership_periods p WHERE p.vehicle_id = NEW.id
  ) THEN
    INSERT INTO vehicle_ownership_periods (vehicle_id, user_id, valid_from, valid_to, created_by_user_id)
    VALUES (
      NEW.id,
      NEW.user_id,
      NEW.created_at,
      CASE WHEN NEW.deregistered_at > NEW.created_at THEN NEW.deregistered_at END,
      NEW.user_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_initial_ownership ON vehicles;
CREATE TRIGGER vehicles_initial_ownership
AFTER INSERT ON vehicles
FOR EACH ROW EXECUTE FUNCTION create_initial_vehicle_ownership();
