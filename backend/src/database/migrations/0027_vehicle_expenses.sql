-- Fahrzeugkosten: Tanken/Laden und sonstige Kosten (Versicherung, Steuer, Wartung …).
-- Grundlage für Gesamtkosten, Kosten pro km und den Privatanteil bei der Fahrtenbuchmethode.
-- Beträge in Cent, damit Summen ohne Rundungsfehler bleiben.

CREATE TABLE IF NOT EXISTS vehicle_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  category text NOT NULL,
  expense_date date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 100000000000),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),

  -- Kilometerstand beim Tanken/Service, Grundlage für Verbrauch und Plausibilisierung
  odometer_meters bigint CHECK (odometer_meters IS NULL OR odometer_meters BETWEEN 0 AND 10000000000),

  -- Nur bei Tanken/Laden
  quantity numeric(12, 3) CHECK (quantity IS NULL OR quantity > 0),
  quantity_unit text,
  fuel_type text,
  full_tank boolean NOT NULL DEFAULT false,

  -- Optionaler Leistungszeitraum (z. B. Jahresversicherung), wird in Auswertungen anteilig verteilt
  period_start date,
  period_end date,

  trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
  vendor text CHECK (vendor IS NULL OR length(vendor) <= 200),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vehicle_expenses
  DROP CONSTRAINT IF EXISTS vehicle_expenses_category_valid,
  DROP CONSTRAINT IF EXISTS vehicle_expenses_quantity_unit_valid,
  DROP CONSTRAINT IF EXISTS vehicle_expenses_fuel_type_valid,
  DROP CONSTRAINT IF EXISTS vehicle_expenses_fuel_fields_only_for_energy,
  DROP CONSTRAINT IF EXISTS vehicle_expenses_quantity_needs_unit,
  DROP CONSTRAINT IF EXISTS vehicle_expenses_period_valid;

ALTER TABLE vehicle_expenses
  ADD CONSTRAINT vehicle_expenses_category_valid CHECK (category IN (
    'fuel', 'charging', 'insurance', 'tax', 'maintenance', 'repair', 'tires',
    'leasing', 'financing', 'parking', 'toll', 'cleaning', 'inspection', 'other'
  )),
  ADD CONSTRAINT vehicle_expenses_quantity_unit_valid CHECK (
    quantity_unit IS NULL OR quantity_unit IN ('l', 'kwh', 'kg')
  ),
  ADD CONSTRAINT vehicle_expenses_fuel_type_valid CHECK (
    fuel_type IS NULL OR fuel_type IN ('petrol', 'diesel', 'lpg', 'cng', 'electric', 'hydrogen', 'other')
  ),
  ADD CONSTRAINT vehicle_expenses_fuel_fields_only_for_energy CHECK (
    category IN ('fuel', 'charging')
    OR (quantity IS NULL AND quantity_unit IS NULL AND fuel_type IS NULL AND NOT full_tank)
  ),
  ADD CONSTRAINT vehicle_expenses_quantity_needs_unit CHECK (
    (quantity IS NULL) = (quantity_unit IS NULL)
  ),
  ADD CONSTRAINT vehicle_expenses_period_valid CHECK (
    (period_start IS NULL AND period_end IS NULL)
    OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start)
  );

CREATE INDEX IF NOT EXISTS vehicle_expenses_vehicle_date_idx
  ON vehicle_expenses (user_id, vehicle_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS vehicle_expenses_trip_idx
  ON vehicle_expenses (trip_id) WHERE trip_id IS NOT NULL;

DROP TRIGGER IF EXISTS vehicle_expenses_set_updated_at ON vehicle_expenses;
CREATE TRIGGER vehicle_expenses_set_updated_at
BEFORE UPDATE ON vehicle_expenses
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
