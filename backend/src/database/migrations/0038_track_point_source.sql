-- Herkunft eines GPS-Punkts: gps = gemessen (App, Import, Dawarich), manual = im Fahrt-Editor
-- gesetzt, routed = vom Routing-Dienst zwischen eigenen Punkten erzeugt. Erzeugte Punkte lassen
-- sich so verwerfen und neu berechnen, ohne gemessene oder gesetzte Punkte anzutasten.
ALTER TABLE track_points ADD COLUMN IF NOT EXISTS point_source text NOT NULL DEFAULT 'gps';
ALTER TABLE track_points DROP CONSTRAINT IF EXISTS track_points_point_source_check;
ALTER TABLE track_points ADD CONSTRAINT track_points_point_source_check
  CHECK (point_source IN ('gps', 'manual', 'routed'));
