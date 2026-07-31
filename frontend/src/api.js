const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export function clearTokens() {
  localStorage.removeItem('fahrtenbuch_access_token');
  localStorage.removeItem('fahrtenbuch_refresh_token');
  localStorage.removeItem('fahrtenbuch_token');
}

export function saveTokens(data) {
  if (data.accessToken) localStorage.setItem('fahrtenbuch_access_token', data.accessToken);
  if (data.refreshToken) localStorage.setItem('fahrtenbuch_refresh_token', data.refreshToken);
  if (data.token && !data.accessToken) localStorage.setItem('fahrtenbuch_access_token', data.token);
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('fahrtenbuch_refresh_token');
  if (!refreshToken) return false;
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) { clearTokens(); return false; }
  saveTokens(await response.json());
  return true;
}

export async function api(path, options = {}, retry = true) {
  const token = localStorage.getItem('fahrtenbuch_access_token') || localStorage.getItem('fahrtenbuch_token');
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  if (response.status === 401 && retry && await refreshAccessToken()) return api(path, options, false);
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen');
  return data;
}

export async function downloadExport(path = '/export') {
  const data = await api(path);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `fahrtenbuch-export-${new Date().toISOString().slice(0,10)}.json`; a.click();
  URL.revokeObjectURL(url);
}
