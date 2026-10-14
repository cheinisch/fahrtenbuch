-- Add an optional second classification level for trips.
-- The primary trip type remains business/private/commute/unclassified.
-- special_category describes a specific purpose without changing tax/business semantics.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS special_category text;

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_special_category_check;

ALTER TABLE trips
  ADD CONSTRAINT trips_special_category_check
  CHECK (
    special_category IS NULL
    OR special_category IN (
      'medical',
      'volunteer',
      'education',
      'application',
      'moving',
      'other'
    )
  );

CREATE INDEX IF NOT EXISTS trips_user_special_category_idx
  ON trips (user_id, special_category)
  WHERE special_category IS NOT NULL
    AND archived_at IS NULL;
