-- Herkunft eines Kosteneintrags (manuell oder CSV-Import, z. B. aus Spritmonitor),
-- damit importierte Daten nachvollziehbar bleiben.

ALTER TABLE vehicle_expenses
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE vehicle_expenses
  DROP CONSTRAINT IF EXISTS vehicle_expenses_source_valid;

ALTER TABLE vehicle_expenses
  ADD CONSTRAINT vehicle_expenses_source_valid CHECK (source IN ('manual', 'csv_import'));
