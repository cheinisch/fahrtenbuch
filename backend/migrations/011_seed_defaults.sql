BEGIN;

INSERT INTO system_settings(key, value, is_secret)
VALUES
  ('registration.enabled', 'false'::jsonb, false),
  ('pairing.expiresSeconds', '120'::jsonb, false),
  ('security.accessTokenMinutes', '15'::jsonb, false),
  ('security.refreshTokenDays', '30'::jsonb, false)
ON CONFLICT (key) DO NOTHING;

COMMIT;
