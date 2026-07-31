-- Fahrtenbuch – erweiterte Benutzer- und Sicherheitsverwaltung
-- Version: 0004

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS totp_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS passkey_enabled boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_first_name_length_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_first_name_length_check
      CHECK (
        first_name IS NULL
        OR length(trim(first_name)) BETWEEN 1 AND 80
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_last_name_length_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_last_name_length_check
      CHECK (
        last_name IS NULL
        OR length(trim(last_name)) BETWEEN 1 AND 80
      );
  END IF;
END;
$$;

COMMENT ON COLUMN users.totp_required IS
  'Der Administrator verlangt die Einrichtung von TOTP. Aktiviert wird TOTP erst nach Verifikation durch den Benutzer.';

COMMENT ON COLUMN users.passkey_enabled IS
  'Erlaubt die Registrierung und Anmeldung mit Passkeys für dieses Benutzerkonto.';
