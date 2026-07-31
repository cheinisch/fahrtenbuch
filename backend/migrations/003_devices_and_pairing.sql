BEGIN;

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  platform device_platform NOT NULL DEFAULT 'unknown',
  device_identifier text,
  push_token text,
  app_version text,
  last_seen_at timestamptz,
  trusted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, device_identifier)
);

CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);
CREATE INDEX IF NOT EXISTS devices_active_idx ON devices(user_id, revoked_at) WHERE revoked_at IS NULL;

ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_device_fk
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  browser_session_id text,
  requested_device_name text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','completed','expired','cancelled')),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS pairings_user_idx ON pairings(user_id);
CREATE INDEX IF NOT EXISTS pairings_pending_idx ON pairings(expires_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS auth_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  method auth_method NOT NULL,
  success boolean NOT NULL,
  ip_address inet,
  user_agent text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_events_user_time_idx ON auth_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_time_idx ON auth_events(created_at DESC);

COMMIT;
