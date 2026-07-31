# Relationen

```text
users
 ├─ user_preferences
 ├─ devices
 │   └─ refresh_tokens
 ├─ passkey_credentials
 ├─ totp_credentials
 │   └─ recovery_codes
 ├─ vehicles
 │   ├─ odometer_entries
 │   └─ trips
 │       ├─ trip_points
 │       ├─ trip_stops
 │       ├─ trip_corrections
 │       ├─ trip_comments
 │       └─ trip_tags ─ tags
 ├─ pairings
 ├─ import_jobs
 ├─ export_jobs
 ├─ api_tokens
 └─ audit_log

external_services
 └─ geocoding_cache
```
