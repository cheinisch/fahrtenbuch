ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS acquisition_type text NOT NULL DEFAULT 'owned';

UPDATE vehicles
SET acquisition_type = 'leasing'
WHERE is_leased = true;

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_acquisition_type_valid;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_acquisition_type_valid
  CHECK (acquisition_type IN ('owned', 'leasing', 'financing'));

-- Die bisherigen Leasingfelder werden bewusst als allgemeine Vertragsdaten
-- weiterverwendet, damit bestehende Installationen ohne Datenverlust migrieren.
