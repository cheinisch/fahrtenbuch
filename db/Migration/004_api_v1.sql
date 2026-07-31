CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trips ADD COLUMN IF NOT EXISTS tracking_status TEXT NOT NULL DEFAULT 'completed'
  CHECK (tracking_status IN ('recording', 'completed'));

CREATE INDEX IF NOT EXISTS idx_trips_tracking_status ON trips(user_id, tracking_status);
