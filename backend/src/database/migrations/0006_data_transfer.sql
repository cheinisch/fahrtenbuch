-- Fahrtenbuch – sichere, wiederholbare Datenimporte
-- Version: 0006
--
-- Fahrtänderungen besitzen bisher eine lokale bigserial-ID.
-- Für wiederholbare JSON-Importe wird deshalb ein stabiler
-- Import-Schlüssel ergänzt. Derselbe Datenexport kann damit
-- mehrfach geprüft oder importiert werden, ohne dieselben
-- historischen Änderungen erneut anzulegen.

ALTER TABLE trip_change_log
  ADD COLUMN IF NOT EXISTS import_key text;

CREATE UNIQUE INDEX IF NOT EXISTS
  trip_change_log_import_key_unique
ON trip_change_log (
  user_id,
  import_key
);
