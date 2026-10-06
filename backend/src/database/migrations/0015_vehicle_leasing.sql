ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS is_leased boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lease_start_date date,
  ADD COLUMN IF NOT EXISTS lease_end_date date,
  ADD COLUMN IF NOT EXISTS lease_included_km integer;

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_lease_dates_valid,
  DROP CONSTRAINT IF EXISTS vehicles_lease_km_valid;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_lease_dates_valid CHECK (
    NOT is_leased OR (
      lease_start_date IS NOT NULL
      AND lease_end_date IS NOT NULL
      AND lease_end_date > lease_start_date
    )
  ),
  ADD CONSTRAINT vehicles_lease_km_valid CHECK (
    NOT is_leased OR (lease_included_km IS NOT NULL AND lease_included_km > 0)
  );
