-- Kilometergeld des Arbeitgebers für Dienstfahrten.
-- Fahrzeug: Standardsatz (€/km). Fahrt: eigener, änderbarer Satz.
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS business_reimbursement_rate_eur numeric(10,4);

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS reimbursement_rate_eur numeric(10,4);

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicle_business_reimbursement_nonnegative;
ALTER TABLE vehicles ADD CONSTRAINT vehicle_business_reimbursement_nonnegative
  CHECK (business_reimbursement_rate_eur IS NULL OR business_reimbursement_rate_eur >= 0);

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trip_reimbursement_rate_nonnegative;
ALTER TABLE trips ADD CONSTRAINT trip_reimbursement_rate_nonnegative
  CHECK (reimbursement_rate_eur IS NULL OR reimbursement_rate_eur >= 0);

-- Den Standardsatz des Fahrzeugs nur übernehmen, wenn eine Fahrt (neu) zur
-- Dienstfahrt wird und noch keinen eigenen Satz hat. Ein vorhandener Satz bleibt
-- erhalten – auch beim Wechsel auf privat und wieder zurück. Bestehende Fahrten
-- werden nicht nachträglich befüllt. Als Trigger, damit alle Wege (Web, App,
-- Tracking, Import) dieselbe Regel nutzen.
CREATE OR REPLACE FUNCTION trips_apply_default_reimbursement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.type = 'business'
     AND NEW.reimbursement_rate_eur IS NULL
     AND (TG_OP = 'INSERT' OR OLD.type IS DISTINCT FROM 'business') THEN
    SELECT v.business_reimbursement_rate_eur
      INTO NEW.reimbursement_rate_eur
      FROM vehicles v
     WHERE v.id = NEW.vehicle_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_default_reimbursement ON trips;
CREATE TRIGGER trips_default_reimbursement
  BEFORE INSERT OR UPDATE OF type ON trips
  FOR EACH ROW
  EXECUTE FUNCTION trips_apply_default_reimbursement();
