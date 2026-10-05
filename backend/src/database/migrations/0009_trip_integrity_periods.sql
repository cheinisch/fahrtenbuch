-- Fahrtenbuch: revisionssichere Hash-Kette und Periodenabschluss.
-- Bestehende Historieneinträge werden deterministisch verkettet.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE trip_history
  ADD COLUMN IF NOT EXISTS previous_hash text,
  ADD COLUMN IF NOT EXISTS entry_hash text;

CREATE TABLE IF NOT EXISTS trip_period_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  label text,
  closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  integrity_hash text,
  CONSTRAINT trip_period_locks_valid_range CHECK (period_end >= period_start),
  CONSTRAINT trip_period_locks_unique UNIQUE (user_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS trip_period_locks_user_range_idx
  ON trip_period_locks (user_id, period_start, period_end);

CREATE OR REPLACE FUNCTION trip_history_hash_payload(
  p_trip_id uuid,
  p_user_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_changed_fields jsonb,
  p_old_values jsonb,
  p_new_values jsonb,
  p_metadata jsonb,
  p_created_at timestamptz,
  p_previous_hash text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      concat_ws(
        '|',
        p_trip_id::text,
        p_user_id::text,
        COALESCE(p_actor_user_id::text, ''),
        p_event_type,
        COALESCE(p_changed_fields, '{}'::jsonb)::text,
        COALESCE(p_old_values, 'null'::jsonb)::text,
        COALESCE(p_new_values, 'null'::jsonb)::text,
        COALESCE(p_metadata, '{}'::jsonb)::text,
        to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
        COALESCE(p_previous_hash, '')
      ),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION seal_trip_history_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT h.entry_hash
  INTO NEW.previous_hash
  FROM trip_history h
  WHERE h.user_id = NEW.user_id
    AND h.entry_hash IS NOT NULL
  ORDER BY h.id DESC
  LIMIT 1
  FOR UPDATE;

  NEW.entry_hash := trip_history_hash_payload(
    NEW.trip_id, NEW.user_id, NEW.actor_user_id, NEW.event_type,
    NEW.changed_fields, NEW.old_values, NEW.new_values, NEW.metadata,
    NEW.created_at, NEW.previous_hash
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_history_seal ON trip_history;
CREATE TRIGGER trip_history_seal
BEFORE INSERT ON trip_history
FOR EACH ROW
EXECUTE FUNCTION seal_trip_history_row();

DO $$
DECLARE
  row_record record;
  last_hash text;
BEGIN
  FOR row_record IN
    SELECT * FROM trip_history ORDER BY user_id, id
  LOOP
    IF row_record.user_id IS DISTINCT FROM (
      SELECT user_id FROM trip_history WHERE id < row_record.id ORDER BY id DESC LIMIT 1
    ) THEN
      last_hash := NULL;
    END IF;

    UPDATE trip_history
    SET
      previous_hash = last_hash,
      entry_hash = trip_history_hash_payload(
        row_record.trip_id, row_record.user_id, row_record.actor_user_id,
        row_record.event_type, row_record.changed_fields, row_record.old_values,
        row_record.new_values, row_record.metadata, row_record.created_at, last_hash
      )
    WHERE id = row_record.id
    RETURNING entry_hash INTO last_hash;
  END LOOP;
END;
$$;

ALTER TABLE trip_history
  ALTER COLUMN entry_hash SET NOT NULL;

CREATE OR REPLACE FUNCTION protect_trip_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trip_history ist unveränderlich';
END;
$$;

DROP TRIGGER IF EXISTS trip_history_immutable ON trip_history;
CREATE TRIGGER trip_history_immutable
BEFORE UPDATE OR DELETE ON trip_history
FOR EACH ROW
EXECUTE FUNCTION protect_trip_history();

CREATE OR REPLACE FUNCTION reject_locked_trip_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  effective_user uuid;
  effective_started timestamptz;
BEGIN
  effective_user := COALESCE(OLD.user_id, NEW.user_id);
  effective_started := COALESCE(OLD.started_at, NEW.started_at);

  IF EXISTS (
    SELECT 1
    FROM trip_period_locks l
    WHERE l.user_id = effective_user
      AND effective_started::date BETWEEN l.period_start AND l.period_end
  ) THEN
    RAISE EXCEPTION 'Fahrt liegt in einem abgeschlossenen Zeitraum'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trips_period_lock ON trips;
CREATE TRIGGER trips_period_lock
BEFORE UPDATE OR DELETE ON trips
FOR EACH ROW
EXECUTE FUNCTION reject_locked_trip_change();

CREATE OR REPLACE FUNCTION reject_locked_trip_tag_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_trip uuid;
BEGIN
  target_trip := COALESCE(NEW.trip_id, OLD.trip_id);
  IF EXISTS (
    SELECT 1
    FROM trips t
    JOIN trip_period_locks l ON l.user_id = t.user_id
    WHERE t.id = target_trip
      AND t.started_at::date BETWEEN l.period_start AND l.period_end
  ) THEN
    RAISE EXCEPTION 'Fahrt liegt in einem abgeschlossenen Zeitraum'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trip_tags_period_lock ON trip_tags;
CREATE TRIGGER trip_tags_period_lock
BEFORE INSERT OR UPDATE OR DELETE ON trip_tags
FOR EACH ROW
EXECUTE FUNCTION reject_locked_trip_tag_change();
