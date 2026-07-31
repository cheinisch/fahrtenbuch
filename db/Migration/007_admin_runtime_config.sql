ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET username = LOWER(REGEXP_REPLACE(SPLIT_PART(email, '@', 1), '[^a-zA-Z0-9._-]+', '-', 'g'))
WHERE username IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (LOWER(username))
  WHERE username IS NOT NULL;
