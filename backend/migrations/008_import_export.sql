BEGIN;

CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status import_status NOT NULL DEFAULT 'pending',
  source_type text NOT NULL,
  original_filename text,
  storage_path text,
  total_rows integer,
  processed_rows integer NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS import_jobs_user_time_idx ON import_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON import_jobs(status);

CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status export_status NOT NULL DEFAULT 'pending',
  format text NOT NULL CHECK (format IN ('csv','json','gpx','pdf')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_path text,
  download_token_hash text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS export_jobs_user_time_idx ON export_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS export_jobs_expiry_idx ON export_jobs(expires_at);

COMMIT;
