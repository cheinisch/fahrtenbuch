-- Bluetooth identifiers are physical/historical attributes. They may recur
-- across archived/deregistered vehicle records and different owners.
ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_bluetooth_unique_per_user;
DROP INDEX IF EXISTS vehicles_bluetooth_unique_per_user;
