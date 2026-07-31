-- Fahrtenbuch – initiales PostgreSQL-Schema
-- Version: 0001
--
-- WICHTIG:
-- Passwörter werden niemals im Klartext und niemals reversibel verschlüsselt
-- gespeichert. Die Spalte users.password_hash enthält ausschließlich einen
-- starken Passwort-Hash, z. B. scrypt oder Argon2id.
--
-- Der Default-Admin aus der .env wird absichtlich NICHT direkt in dieser
-- SQL-Datei angelegt: PostgreSQL-Migrationen haben keinen sicheren Zugriff auf
-- die Prozess-Umgebungsvariablen der Node-Anwendung. Nach der Migration legt
-- seedDefaultAdmin.js den Benutzer mit einem scrypt-Hash an.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- ENUM-Typen
-- ---------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM (
  'admin',
  'user'
);

CREATE TYPE user_status AS ENUM (
  'active',
  'disabled'
);

CREATE TYPE trip_type AS ENUM (
  'business',
  'private',
  'commute',
  'unclassified'
);

CREATE TYPE trip_status AS ENUM (
  'recording',
  'completed',
  'cancelled'
);

CREATE TYPE pairing_status AS ENUM (
  'pending',
  'completed',
  'cancelled',
  'expired'
);

CREATE TYPE sync_operation_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

CREATE TYPE webauthn_challenge_type AS ENUM (
  'register',
  'login'
);

-- ---------------------------------------------------------------------------
-- Gemeinsame Triggerfunktion für updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Benutzer und Authentifizierung
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  email text NOT NULL
    CHECK (length(trim(email)) BETWEEN 3 AND 320),
  username text NOT NULL
    CHECK (length(trim(username)) BETWEEN 3 AND 64),
  display_name text NOT NULL
    CHECK (length(trim(display_name)) BETWEEN 1 AND 120),

  -- Enthält ausschließlich einen scrypt-/Argon2id-Hash, niemals Klartext.
  -- NULL bleibt möglich, damit später echte Passkey-only-Konten möglich sind.
  password_hash text,
  password_changed_at timestamptz,

  role user_role NOT NULL DEFAULT 'user',
  status user_status NOT NULL DEFAULT 'active',

  locale text NOT NULL DEFAULT 'de'
    CHECK (length(locale) BETWEEN 2 AND 16),
  timezone text NOT NULL DEFAULT 'Europe/Berlin'
    CHECK (length(timezone) BETWEEN 1 AND 64),
  theme_mode text NOT NULL DEFAULT 'system'
    CHECK (theme_mode IN ('light', 'dark', 'system')),

  -- TOTP-Secrets müssen vor dem Speichern anwendungsseitig mit AES-256-GCM
  -- oder einer vergleichbaren authentifizierten Verschlüsselung verschlüsselt
  -- werden. Anders als Passwörter müssen sie zur Prüfung wieder lesbar sein.
  totp_secret_encrypted text,
  totp_enabled boolean NOT NULL DEFAULT false,

  force_password_change boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CHECK (NOT totp_enabled OR totp_secret_encrypted IS NOT NULL)
);

CREATE UNIQUE INDEX users_email_unique_active
  ON users (lower(email))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX users_username_unique_active
  ON users (lower(username))
  WHERE deleted_at IS NULL;

CREATE INDEX users_role_status_idx
  ON users (role, status)
  WHERE deleted_at IS NULL;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY
    REFERENCES users(id) ON DELETE CASCADE,

  automatic_tracking_enabled boolean NOT NULL DEFAULT false,
  tracking_accuracy_mode text NOT NULL DEFAULT 'balanced'
    CHECK (tracking_accuracy_mode IN ('high', 'balanced', 'battery')),
  stop_delay_seconds integer NOT NULL DEFAULT 180
    CHECK (stop_delay_seconds BETWEEN 0 AND 3600),
  save_accuracy boolean NOT NULL DEFAULT true,

  map_provider text NOT NULL DEFAULT 'osm'
    CHECK (length(map_provider) BETWEEN 1 AND 64),

  -- Platz für zukünftige benutzerspezifische Einstellungen, ohne für jede
  -- kleine Option sofort eine neue Migration zu benötigen.
  settings jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(settings) = 'object'),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_settings_set_updated_at
BEFORE UPDATE ON user_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  device_name text NOT NULL
    CHECK (length(trim(device_name)) BETWEEN 1 AND 120),
  device_type text NOT NULL DEFAULT 'unknown'
    CHECK (length(device_type) BETWEEN 1 AND 32),
  platform text,
  app_version text,
  push_token text,

  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX devices_user_id_idx
  ON devices (user_id);

CREATE INDEX devices_user_active_idx
  ON devices (user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid
    REFERENCES devices(id) ON DELETE CASCADE,

  -- Refresh-Tokens werden nur als SHA-256-Hash gespeichert.
  token_hash text NOT NULL UNIQUE,
  token_family_id uuid NOT NULL,

  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  replaced_by_session_id uuid
    REFERENCES refresh_sessions(id) ON DELETE SET NULL,

  created_ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (expires_at > created_at)
);

CREATE INDEX refresh_sessions_user_idx
  ON refresh_sessions (user_id);

CREATE INDEX refresh_sessions_family_idx
  ON refresh_sessions (token_family_id);

CREATE INDEX refresh_sessions_active_expiry_idx
  ON refresh_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  -- Auch Reset-Tokens werden ausschließlich gehasht gespeichert.
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (expires_at > created_at)
);

CREATE INDEX password_reset_tokens_user_idx
  ON password_reset_tokens (user_id, created_at DESC);

CREATE INDEX password_reset_tokens_active_expiry_idx
  ON password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

CREATE TABLE passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0
    CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}'::text[],

  name text NOT NULL
    CHECK (length(trim(name)) BETWEEN 1 AND 120),
  backed_up boolean,
  device_type text,

  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX passkeys_user_idx
  ON passkeys (user_id);

CREATE TABLE webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid
    REFERENCES users(id) ON DELETE CASCADE,
  challenge_type webauthn_challenge_type NOT NULL,

  -- Die Challenge wird ebenfalls nur als Hash gespeichert.
  challenge_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (expires_at > created_at)
);

CREATE INDEX webauthn_challenges_expiry_idx
  ON webauthn_challenges (expires_at)
  WHERE used_at IS NULL;

CREATE TABLE pairing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  -- Das im QR-Code enthaltene Pairing-Token wird nur gehasht gespeichert.
  token_hash text NOT NULL UNIQUE,
  status pairing_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,

  completed_device_id uuid
    REFERENCES devices(id) ON DELETE SET NULL,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (expires_at > created_at)
);

CREATE INDEX pairing_requests_user_idx
  ON pairing_requests (user_id, created_at DESC);

CREATE INDEX pairing_requests_expiry_idx
  ON pairing_requests (expires_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Fahrzeuge
-- ---------------------------------------------------------------------------

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  name text NOT NULL
    CHECK (length(trim(name)) BETWEEN 1 AND 120),
  manufacturer text,
  model text,
  license_plate text,
  color text,

  odometer_meters bigint
    CHECK (odometer_meters IS NULL OR odometer_meters >= 0),

  -- Bluetooth-MAC oder stabile Gerätekennung aus der Android-App.
  bluetooth_identifier text,
  is_default boolean NOT NULL DEFAULT false,

  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, user_id)
);

CREATE INDEX vehicles_user_idx
  ON vehicles (user_id, created_at DESC);

CREATE UNIQUE INDEX vehicles_bluetooth_unique_per_user
  ON vehicles (user_id, lower(bluetooth_identifier))
  WHERE bluetooth_identifier IS NOT NULL
    AND archived_at IS NULL;

CREATE UNIQUE INDEX vehicles_one_default_per_user
  ON vehicles (user_id)
  WHERE is_default = true
    AND archived_at IS NULL;

CREATE TRIGGER vehicles_set_updated_at
BEFORE UPDATE ON vehicles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Fahrten und GPS-Punkte
-- ---------------------------------------------------------------------------

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL,

  type trip_type NOT NULL DEFAULT 'unclassified',
  status trip_status NOT NULL DEFAULT 'recording',

  started_at timestamptz NOT NULL,
  ended_at timestamptz,

  start_lat double precision
    CHECK (start_lat IS NULL OR start_lat BETWEEN -90 AND 90),
  start_lon double precision
    CHECK (start_lon IS NULL OR start_lon BETWEEN -180 AND 180),
  end_lat double precision
    CHECK (end_lat IS NULL OR end_lat BETWEEN -90 AND 90),
  end_lon double precision
    CHECK (end_lon IS NULL OR end_lon BETWEEN -180 AND 180),

  start_address text,
  end_address text,
  purpose text,
  contact text,
  notes text,

  distance_meters bigint
    CHECK (distance_meters IS NULL OR distance_meters >= 0),
  duration_seconds integer
    CHECK (duration_seconds IS NULL OR duration_seconds >= 0),

  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'android', 'import')),

  -- Optimistische Sperre für Offline-Synchronisation.
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),

  completed_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, user_id),

  CONSTRAINT trips_vehicle_owner_fk
    FOREIGN KEY (vehicle_id, user_id)
    REFERENCES vehicles (id, user_id)
    ON DELETE RESTRICT,

  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (
    (status <> 'completed')
    OR ended_at IS NOT NULL
  )
);

CREATE INDEX trips_user_started_idx
  ON trips (user_id, started_at DESC);

CREATE INDEX trips_vehicle_started_idx
  ON trips (vehicle_id, started_at DESC);

CREATE INDEX trips_type_idx
  ON trips (user_id, type);

CREATE INDEX trips_status_idx
  ON trips (user_id, status);

CREATE INDEX trips_unclassified_idx
  ON trips (user_id, started_at DESC)
  WHERE type = 'unclassified'
    AND archived_at IS NULL;

CREATE TRIGGER trips_set_updated_at
BEFORE UPDATE ON trips
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE track_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL
    REFERENCES trips(id) ON DELETE CASCADE,

  sequence_number bigint NOT NULL
    CHECK (sequence_number >= 0),

  lat double precision NOT NULL
    CHECK (lat BETWEEN -90 AND 90),
  lon double precision NOT NULL
    CHECK (lon BETWEEN -180 AND 180),

  altitude_meters double precision,
  accuracy_meters double precision
    CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  speed_mps double precision
    CHECK (speed_mps IS NULL OR speed_mps >= 0),
  bearing_degrees double precision
    CHECK (
      bearing_degrees IS NULL
      OR (bearing_degrees >= 0 AND bearing_degrees < 360)
    ),

  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (trip_id, sequence_number)
);

CREATE INDEX track_points_trip_time_idx
  ON track_points (trip_id, recorded_at);

CREATE INDEX track_points_trip_sequence_idx
  ON track_points (trip_id, sequence_number);

-- Empfangene GPS-Batches werden damit idempotent verarbeitet. Ein erneuter
-- Upload desselben Batches erzeugt keine doppelten Punkte.
CREATE TABLE track_point_batches (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL
    REFERENCES trips(id) ON DELETE CASCADE,
  device_id uuid
    REFERENCES devices(id) ON DELETE SET NULL,

  payload_hash text NOT NULL,
  point_count integer NOT NULL DEFAULT 0
    CHECK (point_count >= 0),
  first_sequence_number bigint,
  last_sequence_number bigint,

  received_at timestamptz NOT NULL DEFAULT now(),

  CHECK (
    first_sequence_number IS NULL
    OR last_sequence_number IS NULL
    OR last_sequence_number >= first_sequence_number
  )
);

CREATE INDEX track_point_batches_trip_idx
  ON track_point_batches (trip_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------

CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  name text NOT NULL
    CHECK (length(trim(name)) BETWEEN 1 AND 64),
  color text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX tags_name_unique_per_user
  ON tags (user_id, lower(name));

CREATE TRIGGER tags_set_updated_at
BEFORE UPDATE ON tags
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE trip_tags (
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL,
  tag_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (trip_id, tag_id),

  CONSTRAINT trip_tags_trip_owner_fk
    FOREIGN KEY (trip_id, user_id)
    REFERENCES trips (id, user_id)
    ON DELETE CASCADE,

  CONSTRAINT trip_tags_tag_owner_fk
    FOREIGN KEY (tag_id, user_id)
    REFERENCES tags (id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX trip_tags_user_idx
  ON trip_tags (user_id);

-- ---------------------------------------------------------------------------
-- Offline-Synchronisation
-- ---------------------------------------------------------------------------

CREATE TABLE sync_operations (
  -- operationId wird bereits offline auf dem Client als UUID erzeugt.
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid
    REFERENCES devices(id) ON DELETE SET NULL,

  operation_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  payload_hash text NOT NULL,

  status sync_operation_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  error_code text,
  error_message text,

  created_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  completed_at timestamptz,

  UNIQUE (user_id, id)
);

CREATE INDEX sync_operations_user_status_idx
  ON sync_operations (user_id, status, created_at);

CREATE INDEX sync_operations_device_idx
  ON sync_operations (device_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Administration, Konfiguration und Audit
-- ---------------------------------------------------------------------------

CREATE TABLE app_settings (
  key text PRIMARY KEY
    CHECK (length(trim(key)) BETWEEN 1 AND 120),
  value jsonb NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid
    REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER app_settings_set_updated_at
BEFORE UPDATE ON app_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id uuid
    REFERENCES users(id) ON DELETE SET NULL,

  action text NOT NULL,
  entity_type text,
  entity_id uuid,

  request_id text,
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_actor_time_idx
  ON audit_log (actor_user_id, created_at DESC);

CREATE INDEX audit_log_entity_idx
  ON audit_log (entity_type, entity_id);

CREATE INDEX audit_log_time_idx
  ON audit_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- Initiale öffentliche Standardwerte
-- ---------------------------------------------------------------------------

INSERT INTO app_settings (key, value, is_public)
VALUES
  (
    'tracking.defaults',
    '{"minimumDistanceMeters":10,"minimumTimeSeconds":5}'::jsonb,
    true
  ),
  (
    'pairing.expiresSeconds',
    '120'::jsonb,
    true
  ),
  (
    'map.defaults',
    '{"provider":"osm","defaultLatitude":50.1109,"defaultLongitude":8.6821,"defaultZoom":6}'::jsonb,
    true
  );
