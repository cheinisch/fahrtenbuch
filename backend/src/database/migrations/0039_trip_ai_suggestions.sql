-- KI-Vorschlag zur Fahrtart (dienstlich/privat/Arbeitsweg) je Fahrt. Nur ein Vorschlag:
-- übernommen wird er erst, wenn der Nutzer ihn bestätigt (PUT /trips/{id}/classify).
-- type NULL = die KI war sich nicht sicher genug; die Zeile verhindert erneute Anfragen.
CREATE TABLE IF NOT EXISTS trip_ai_suggestions (
  trip_id uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text,
  confidence numeric(4, 3),
  reason text,
  provider text NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz
);

ALTER TABLE trip_ai_suggestions DROP CONSTRAINT IF EXISTS trip_ai_suggestions_type_check;
ALTER TABLE trip_ai_suggestions ADD CONSTRAINT trip_ai_suggestions_type_check
  CHECK (type IS NULL OR type IN ('business', 'private', 'commute'));

CREATE INDEX IF NOT EXISTS trip_ai_suggestions_user_idx ON trip_ai_suggestions (user_id);
