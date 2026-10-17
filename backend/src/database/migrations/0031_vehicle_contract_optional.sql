-- Vertragsdaten (Beginn, Ende, Kilometerlimit) sind für Leasing und Finanzierung
-- gleichermaßen optional. Die Constraints aus 0015 verlangten sie bei Leasing
-- zwingend (Anlegen ohne Vertragsdaten endete mit HTTP 500) und prüften
-- Finanzierung gar nicht. Neu: entweder keine Vertragsdaten oder vollständige
-- und gültige – unabhängig von der Finanzierungsart.

-- Altlasten: Fahrzeuge im Eigentum führen keine Vertragsdaten
UPDATE vehicles
SET lease_start_date = NULL,
    lease_end_date = NULL,
    lease_included_km = NULL
WHERE COALESCE(acquisition_type, CASE WHEN is_leased THEN 'leasing' ELSE 'owned' END) = 'owned'
  AND (lease_start_date IS NOT NULL OR lease_end_date IS NOT NULL OR lease_included_km IS NOT NULL);

-- Unvollständige Vertragsdaten (nur über Altversionen möglich) verwerfen
UPDATE vehicles
SET lease_start_date = NULL,
    lease_end_date = NULL,
    lease_included_km = NULL
WHERE (lease_start_date IS NOT NULL OR lease_end_date IS NOT NULL OR lease_included_km IS NOT NULL)
  AND NOT (
    lease_start_date IS NOT NULL
    AND lease_end_date IS NOT NULL
    AND lease_end_date > lease_start_date
    AND lease_included_km IS NOT NULL
    AND lease_included_km > 0
  );

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_lease_dates_valid,
  DROP CONSTRAINT IF EXISTS vehicles_lease_km_valid,
  DROP CONSTRAINT IF EXISTS vehicles_contract_data_valid;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_contract_data_valid CHECK (
    (lease_start_date IS NULL AND lease_end_date IS NULL AND lease_included_km IS NULL)
    OR (
      lease_start_date IS NOT NULL
      AND lease_end_date IS NOT NULL
      AND lease_end_date > lease_start_date
      AND lease_included_km IS NOT NULL
      AND lease_included_km > 0
    )
  );
