-- Externe Anmeldekonten (Google, Microsoft), die ein Benutzer mit seinem
-- bestehenden Konto verknüpft. Keine Selbstregistrierung: eine Identität
-- zeigt immer auf einen vorhandenen Benutzer.

CREATE TABLE IF NOT EXISTS user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  provider text NOT NULL,
  -- Stabile Kennung beim Anbieter (Google: sub, Microsoft: tid:oid)
  subject text NOT NULL,
  -- Nur zur Anzeige; nicht für die Zuordnung verwenden
  email text,
  display_name text,

  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_identities
  DROP CONSTRAINT IF EXISTS user_identities_provider_check;

ALTER TABLE user_identities
  ADD CONSTRAINT user_identities_provider_check
  CHECK (provider IN ('google', 'microsoft'));

CREATE UNIQUE INDEX IF NOT EXISTS user_identities_provider_subject_idx
  ON user_identities (provider, subject);

-- Pro Anbieter höchstens ein Konto je Benutzer
CREATE UNIQUE INDEX IF NOT EXISTS user_identities_user_provider_idx
  ON user_identities (user_id, provider);

-- Laufende Autorisierungen (state, PKCE, nonce). Nur Hashes bzw.
-- verschlüsselte Werte, Lebensdauer wenige Minuten.
CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  -- Hash des Browser-Cookies, bindet den Callback an den startenden Browser
  browser_binding_hash text NOT NULL,
  provider text NOT NULL,
  purpose text NOT NULL,
  user_id uuid
    REFERENCES users(id) ON DELETE CASCADE,
  code_verifier_encrypted text NOT NULL,
  nonce_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE oauth_states
  DROP CONSTRAINT IF EXISTS oauth_states_purpose_check;

ALTER TABLE oauth_states
  ADD CONSTRAINT oauth_states_purpose_check
  CHECK (
    (purpose = 'login' AND user_id IS NULL)
    OR (purpose = 'link' AND user_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx
  ON oauth_states (expires_at)
  WHERE used_at IS NULL;

-- Einmal-Ticket nach erfolgreichem Callback; die Web-App tauscht es
-- (ggf. zusammen mit dem TOTP-Code) gegen Tokens.
CREATE TABLE IF NOT EXISTS oauth_login_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL
    REFERENCES user_identities(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_login_tickets_expiry_idx
  ON oauth_login_tickets (expires_at)
  WHERE used_at IS NULL;
