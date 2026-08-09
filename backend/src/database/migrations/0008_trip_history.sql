-- Fahrtenbuch: vollständige, unveränderliche Fahrten-Historie.
-- Ergänzt den älteren trip_change_log um Anlegen, Archivieren, Klassifizieren
-- und Tag-Änderungen. Die Historie wird bewusst ohne FK auf trips geführt,
-- damit sie auch nach einer späteren physischen Löschung erhalten bleibt.

CREATE TABLE IF NOT EXISTS trip_history (
  id bigserial PRIMARY KEY,
  trip_id uuid NOT NULL,
  user_id uuid NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL CHECK (
    event_type IN (
      'CREATED',
      'UPDATED',
      'CLASSIFIED',
      'ARCHIVED',
      'DELETED',
      'TAG_ADDED',
      'TAG_REMOVED',
      'MAP_MATCHED',
      'BASELINE'
    )
  ),
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_change_log_id bigint UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_history_trip_created_idx
  ON trip_history (trip_id, created_at, id);

CREATE INDEX IF NOT EXISTS trip_history_user_created_idx
  ON trip_history (user_id, created_at DESC);

COMMENT ON TABLE trip_history IS
  'Unveränderliche Audit-Historie aller fachlichen Änderungen an Fahrten.';

CREATE OR REPLACE FUNCTION trip_history_changed_fields(
  old_row jsonb,
  new_row jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      key,
      jsonb_build_object(
        'old', old_row -> key,
        'new', new_row -> key
      )
    ),
    '{}'::jsonb
  )
  FROM (
    SELECT key
    FROM (
      SELECT jsonb_object_keys(COALESCE(old_row, '{}'::jsonb)) AS key
      UNION
      SELECT jsonb_object_keys(COALESCE(new_row, '{}'::jsonb)) AS key
    ) keys
    WHERE (old_row -> key) IS DISTINCT FROM (new_row -> key)
  ) changed;
$$;

CREATE OR REPLACE FUNCTION log_trip_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_name text;
  old_json jsonb;
  new_json jsonb;
  fields jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_json := to_jsonb(NEW);

    INSERT INTO trip_history (
      trip_id,
      user_id,
      actor_user_id,
      event_type,
      changed_fields,
      old_values,
      new_values,
      metadata
    ) VALUES (
      NEW.id,
      NEW.user_id,
      NEW.user_id,
      'CREATED',
      trip_history_changed_fields(NULL, new_json),
      NULL,
      new_json,
      jsonb_build_object('source', COALESCE(NEW.source, 'unknown'))
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
    fields := trip_history_changed_fields(old_json, new_json);

    IF fields = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
      event_name := 'ARCHIVED';
    ELSIF OLD.type IS DISTINCT FROM NEW.type THEN
      event_name := 'CLASSIFIED';
    ELSE
      event_name := 'UPDATED';
    END IF;

    INSERT INTO trip_history (
      trip_id,
      user_id,
      actor_user_id,
      event_type,
      changed_fields,
      old_values,
      new_values,
      metadata
    ) VALUES (
      OLD.id,
      OLD.user_id,
      OLD.user_id,
      event_name,
      fields,
      old_json,
      new_json,
      '{}'::jsonb
    );

    RETURN NEW;
  END IF;

  INSERT INTO trip_history (
    trip_id,
    user_id,
    actor_user_id,
    event_type,
    changed_fields,
    old_values,
    new_values,
    metadata
  ) VALUES (
    OLD.id,
    OLD.user_id,
    OLD.user_id,
    'DELETED',
    trip_history_changed_fields(to_jsonb(OLD), NULL),
    to_jsonb(OLD),
    NULL,
    '{}'::jsonb
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trips_history_audit ON trips;
CREATE TRIGGER trips_history_audit
AFTER INSERT OR UPDATE OR DELETE ON trips
FOR EACH ROW
EXECUTE FUNCTION log_trip_history();

CREATE OR REPLACE FUNCTION log_trip_tag_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tag_json jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'color', t.color
    )
    INTO tag_json
    FROM tags t
    WHERE t.id = NEW.tag_id;

    INSERT INTO trip_history (
      trip_id,
      user_id,
      actor_user_id,
      event_type,
      changed_fields,
      old_values,
      new_values,
      metadata
    ) VALUES (
      NEW.trip_id,
      NEW.user_id,
      NEW.user_id,
      'TAG_ADDED',
      jsonb_build_object(
        'tags',
        jsonb_build_object('old', NULL, 'new', tag_json)
      ),
      NULL,
      jsonb_build_object('tag', tag_json),
      '{}'::jsonb
    );

    RETURN NEW;
  END IF;

  SELECT jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'color', t.color
  )
  INTO tag_json
  FROM tags t
  WHERE t.id = OLD.tag_id;

  INSERT INTO trip_history (
    trip_id,
    user_id,
    actor_user_id,
    event_type,
    changed_fields,
    old_values,
    new_values,
    metadata
  ) VALUES (
    OLD.trip_id,
    OLD.user_id,
    OLD.user_id,
    'TAG_REMOVED',
    jsonb_build_object(
      'tags',
      jsonb_build_object('old', tag_json, 'new', NULL)
    ),
    jsonb_build_object('tag', tag_json),
    NULL,
    '{}'::jsonb
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trip_tags_history_audit ON trip_tags;
CREATE TRIGGER trip_tags_history_audit
AFTER INSERT OR DELETE ON trip_tags
FOR EACH ROW
EXECUTE FUNCTION log_trip_tag_history();

-- Vorhandene ältere Änderungsdaten übernehmen. So geht die bisherige
-- Historie bei einem Upgrade nicht verloren.
INSERT INTO trip_history (
  trip_id,
  user_id,
  actor_user_id,
  event_type,
  changed_fields,
  old_values,
  new_values,
  metadata,
  legacy_change_log_id,
  created_at
)
SELECT
  l.trip_id,
  l.user_id,
  l.user_id,
  CASE WHEN l.operation = 'DELETE' THEN 'DELETED' ELSE 'UPDATED' END,
  trip_history_changed_fields(l.old_values, l.new_values),
  l.old_values,
  l.new_values,
  jsonb_build_object('migratedFrom', 'trip_change_log'),
  l.id,
  l.changed_at
FROM trip_change_log l
ON CONFLICT (legacy_change_log_id) DO NOTHING;

-- Für bestehende Fahrten ohne historischen Anlege-Eintrag wird ein
-- nachvollziehbarer Ausgangszustand hinterlegt.
INSERT INTO trip_history (
  trip_id,
  user_id,
  actor_user_id,
  event_type,
  changed_fields,
  old_values,
  new_values,
  metadata,
  created_at
)
SELECT
  t.id,
  t.user_id,
  NULL,
  'BASELINE',
  '{}'::jsonb,
  NULL,
  to_jsonb(t),
  jsonb_build_object('reason', 'history_feature_enabled'),
  now()
FROM trips t
WHERE NOT EXISTS (
  SELECT 1
  FROM trip_history h
  WHERE h.trip_id = t.id
);

-- Historieneinträge dürfen nach dem Schreiben nicht verändert werden.
CREATE OR REPLACE FUNCTION prevent_trip_history_mutation()
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
EXECUTE FUNCTION prevent_trip_history_mutation();
