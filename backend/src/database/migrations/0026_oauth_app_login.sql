-- Anmeldung mit Google/Microsoft aus der mobilen App.
-- Statt des Browser-Cookies (der Custom Tab teilt ihn nicht mit der App)
-- bindet ein PKCE-Challenge der App das Ticket an genau diese App-Instanz.

ALTER TABLE oauth_states
  ADD COLUMN IF NOT EXISTS app_challenge text,
  ADD COLUMN IF NOT EXISTS app_redirect_uri text;

-- Bei App-Anmeldungen gibt es keinen Browser-Cookie
ALTER TABLE oauth_states
  ALTER COLUMN browser_binding_hash DROP NOT NULL;

ALTER TABLE oauth_states
  DROP CONSTRAINT IF EXISTS oauth_states_binding_check;

ALTER TABLE oauth_states
  ADD CONSTRAINT oauth_states_binding_check
  CHECK (
    (app_challenge IS NULL AND app_redirect_uri IS NULL AND browser_binding_hash IS NOT NULL)
    OR (
      purpose = 'login'
      AND app_challenge IS NOT NULL
      AND app_redirect_uri IS NOT NULL
      AND browser_binding_hash IS NULL
    )
  );

ALTER TABLE oauth_login_tickets
  ADD COLUMN IF NOT EXISTS app_challenge text;
