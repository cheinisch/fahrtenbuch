ALTER TABLE vehicles
 ADD COLUMN IF NOT EXISTS lease_excess_tolerance_km integer,
 ADD COLUMN IF NOT EXISTS lease_shortfall_tolerance_km integer,
 ADD COLUMN IF NOT EXISTS lease_excess_rate_eur numeric(10,4),
 ADD COLUMN IF NOT EXISTS lease_shortfall_rate_eur numeric(10,4);
ALTER TABLE vehicles ADD CONSTRAINT vehicle_lease_settlement_nonnegative CHECK (
 (lease_excess_tolerance_km IS NULL OR lease_excess_tolerance_km >= 0) AND
 (lease_shortfall_tolerance_km IS NULL OR lease_shortfall_tolerance_km >= 0) AND
 (lease_excess_rate_eur IS NULL OR lease_excess_rate_eur >= 0) AND
 (lease_shortfall_rate_eur IS NULL OR lease_shortfall_rate_eur >= 0)
);