ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS bt_mac TEXT,
  ADD COLUMN IF NOT EXISTS bt_mac_updated_at TIMESTAMPTZ;

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_bt_mac_format;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_bt_mac_format
  CHECK (bt_mac IS NULL OR bt_mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_user_bt_mac
  ON vehicles(user_id, bt_mac)
  WHERE bt_mac IS NOT NULL;
