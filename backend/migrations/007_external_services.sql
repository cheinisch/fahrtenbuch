BEGIN;

CREATE TABLE IF NOT EXISTS external_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type service_type NOT NULL,
  name text NOT NULL,
  base_url text NOT NULL,
  internal_only boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  timeout_ms integer NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 120000),
  api_key_encrypted text,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_type, name)
);

CREATE INDEX IF NOT EXISTS external_services_type_enabled_idx
  ON external_services(service_type, enabled, priority);

ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_map_provider_fk
  FOREIGN KEY (map_provider_id) REFERENCES external_services(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS geocoding_cache (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id uuid REFERENCES external_services(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  response jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_id, cache_key)
);

CREATE INDEX IF NOT EXISTS geocoding_cache_expires_idx ON geocoding_cache(expires_at);

COMMIT;
