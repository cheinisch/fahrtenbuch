export const USER_PUBLIC_COLUMNS = `
  u.id,
  u.email,
  u.username,
  u.display_name,
  u.first_name,
  u.last_name,
  u.role,
  u.status,
  u.locale,
  u.timezone,
  u.theme_mode,
  u.totp_enabled,
  u.totp_required,
  u.passkey_enabled,
  (u.password_hash IS NOT NULL) AS has_password,
  u.force_password_change,
  u.last_login_at,
  u.created_at,
  u.updated_at
`;

export { mapUser } from "../lib/mappers.js";
