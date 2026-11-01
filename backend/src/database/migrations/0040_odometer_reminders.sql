-- Erinnerung an den Kilometerstand: Einstellungen je Fahrzeug und die daraus erzeugten
-- Erinnerungen, die die Apps abholen und als Benachrichtigung zeigen.
CREATE TABLE IF NOT EXISTS vehicle_odometer_reminder_settings (
  vehicle_id uuid PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  frequency text NOT NULL DEFAULT 'monthly',
  weekday smallint NOT NULL DEFAULT 1,
  day_of_month smallint NOT NULL DEFAULT 1,
  hour smallint NOT NULL DEFAULT 18,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vehicle_odometer_reminder_settings
  DROP CONSTRAINT IF EXISTS vehicle_odometer_reminder_settings_frequency_check;
ALTER TABLE vehicle_odometer_reminder_settings
  ADD CONSTRAINT vehicle_odometer_reminder_settings_frequency_check
  CHECK (frequency IN ('weekly', 'monthly', 'month_end'));

ALTER TABLE vehicle_odometer_reminder_settings
  DROP CONSTRAINT IF EXISTS vehicle_odometer_reminder_settings_ranges_check;
ALTER TABLE vehicle_odometer_reminder_settings
  ADD CONSTRAINT vehicle_odometer_reminder_settings_ranges_check
  CHECK (weekday BETWEEN 1 AND 7 AND day_of_month BETWEEN 1 AND 28 AND hour BETWEEN 0 AND 23);

CREATE INDEX IF NOT EXISTS vehicle_odometer_reminder_settings_enabled_idx
  ON vehicle_odometer_reminder_settings (user_id) WHERE enabled;

-- Eine Erinnerung je Fahrzeug und Kalendertag (Ortszeit), damit der Worker sie genau einmal anlegt.
CREATE TABLE IF NOT EXISTS odometer_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  UNIQUE (vehicle_id, due_date)
);

CREATE INDEX IF NOT EXISTS odometer_reminders_open_idx
  ON odometer_reminders (user_id, due_date DESC) WHERE acknowledged_at IS NULL;
