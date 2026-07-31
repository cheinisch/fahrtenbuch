CREATE TABLE IF NOT EXISTS app_pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','expired','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  device_id TEXT,
  device_name TEXT,
  platform TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_pairings_user_created ON app_pairings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_pairings_expiry ON app_pairings(status, expires_at);

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS app_version TEXT;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_device ON refresh_tokens(user_id, device_id);
