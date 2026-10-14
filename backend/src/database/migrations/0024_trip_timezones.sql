-- Time zone in which a trip took place (IANA id, e.g. Europe/Berlin).
-- Stored as zone id, not as fixed offset, so daylight saving time is applied
-- correctly for every timestamp. NULL means: fall back to the user's timezone.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS start_timezone text,
  ADD COLUMN IF NOT EXISTS end_timezone text;

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_start_timezone_check;

ALTER TABLE trips
  ADD CONSTRAINT trips_start_timezone_check
  CHECK (start_timezone IS NULL OR length(start_timezone) BETWEEN 1 AND 64);

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_end_timezone_check;

ALTER TABLE trips
  ADD CONSTRAINT trips_end_timezone_check
  CHECK (end_timezone IS NULL OR length(end_timezone) BETWEEN 1 AND 64);
