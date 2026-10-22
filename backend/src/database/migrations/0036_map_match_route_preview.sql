-- Vereinfachte Straßenroute für die Kartenübersicht. Das Dashboard hat bisher
-- bei jedem Laden die komplette Route jeder Fahrt ausgepackt und ausgedünnt –
-- bei vielen langen Fahrten dauerte das Minuten. Neue Ergebnisse speichert der
-- Worker vereinfacht (Douglas-Peucker); Bestand wird hier gleichmäßig auf
-- höchstens ~500 Punkte ausgedünnt.
ALTER TABLE trip_map_matches ADD COLUMN IF NOT EXISTS route_preview jsonb;

-- Länge je Route nur einmal bestimmen: jsonb_array_length im Filter je
-- Element würde die Route für jedes Element erneut auspacken.
UPDATE trip_map_matches m
SET route_preview = p.preview
FROM (
  SELECT r.trip_id, jsonb_agg(c.value ORDER BY c.ordinality) AS preview
  FROM (
    SELECT trip_id, route, jsonb_array_length(route) AS n
    FROM trip_map_matches
    WHERE route IS NOT NULL AND route_preview IS NULL AND jsonb_typeof(route) = 'array'
    OFFSET 0
  ) r
  CROSS JOIN LATERAL jsonb_array_elements(r.route) WITH ORDINALITY c(value, ordinality)
  WHERE c.ordinality = 1
     OR c.ordinality = r.n
     OR mod(c.ordinality - 1, GREATEST(1, ceil(r.n / 500.0)::bigint)) = 0
  GROUP BY r.trip_id
) p
WHERE p.trip_id = m.trip_id;
