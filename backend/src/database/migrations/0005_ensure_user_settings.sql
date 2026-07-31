-- ---------------------------------------------------------------------------
-- Fehlende user_settings-Datensätze ergänzen
--
-- Hintergrund:
-- Ältere oder manuell angelegte Benutzer können noch keinen Eintrag in
-- user_settings besitzen. Die Spalten-Defaults erzeugen dabei vollständige
-- und gültige Einstellungsdatensätze.
-- ---------------------------------------------------------------------------

INSERT INTO user_settings (user_id)
SELECT u.id
FROM users u
LEFT JOIN user_settings us
  ON us.user_id = u.id
WHERE u.deleted_at IS NULL
  AND us.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;
