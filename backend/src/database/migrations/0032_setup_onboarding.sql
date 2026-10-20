-- Einrichtungsassistenten beim ersten Login.
--
-- users.onboarding_completed_at: NULL = der Benutzer sieht beim nächsten Login den
-- Assistenten (eigenes Passwort, Profil, Konten, Fahrzeuge).
-- app_settings 'setup.completed': gesetzt, sobald ein Admin die Ersteinrichtung des
-- Servers abgeschlossen hat; fehlt der Eintrag, startet der Server-Assistent.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Bestehende Installationen: wer sich schon angemeldet hat, kennt die App bereits.
UPDATE users
SET onboarding_completed_at = COALESCE(last_login_at, created_at)
WHERE onboarding_completed_at IS NULL
  AND last_login_at IS NOT NULL;

-- Ein Server, auf dem sich schon jemand angemeldet hat, ist eingerichtet. Frische
-- Installationen (noch keine Anmeldung) bekommen keinen Eintrag.
INSERT INTO app_settings (key, value, is_public)
SELECT
  'setup.completed',
  jsonb_build_object('completedAt', now(), 'source', 'migration'),
  false
WHERE EXISTS (SELECT 1 FROM users WHERE last_login_at IS NOT NULL)
ON CONFLICT (key) DO NOTHING;
