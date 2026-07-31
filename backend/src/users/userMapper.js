export const USER_PUBLIC_COLUMNS = `
  u.id,
  u.email,
  u.username,
  u.display_name,
  u.role,
  u.status,
  u.locale,
  u.timezone,
  u.theme_mode,
  u.totp_enabled,
  u.force_password_change,
  u.last_login_at,
  u.created_at,
  u.updated_at
`;

export function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    locale: row.locale,
    timezone: row.timezone,
    themeMode: row.theme_mode,
    totpEnabled: row.totp_enabled,
    forcePasswordChange: row.force_password_change,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}