import { ApiError } from "./auth.js";

async function apiRequest(
  accessToken,
  path,
  options = {},
) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      body?.error?.message ||
        "Die Anfrage ist fehlgeschlagen.",
      response.status,
      body?.error?.code || "REQUEST_FAILED",
    );
  }

  return body;
}

export function getDashboard(accessToken) {
  return apiRequest(
    accessToken,
    "/api/v1/dashboard",
  );
}

export function getPersonalSettings(accessToken) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/settings",
  );
}

export function updateProfile(
  accessToken,
  profile,
) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/profile",
    {
      method: "PATCH",
      body: JSON.stringify(profile),
    },
  );
}

export function updatePersonalSettings(
  accessToken,
  settings,
) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/settings",
    {
      method: "PATCH",
      body: JSON.stringify(settings),
    },
  );
}

export function changePassword(
  accessToken,
  passwords,
) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/password",
    {
      method: "POST",
      body: JSON.stringify(passwords),
    },
  );
}

export function getDevices(accessToken) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/devices",
  );
}

export function revokeDevice(
  accessToken,
  deviceId,
) {
  return apiRequest(
    accessToken,
    `/api/v1/users/me/devices/${deviceId}`,
    {
      method: "DELETE",
    },
  );
}

export function getAdminOverview(accessToken) {
  return apiRequest(
    accessToken,
    "/api/v1/admin/overview",
  );
}

export function getAdminUsers(accessToken) {
  return apiRequest(
    accessToken,
    "/api/v1/admin/users",
  );
}

export function updateAdminUser(
  accessToken,
  userId,
  changes,
) {
  return apiRequest(
    accessToken,
    `/api/v1/admin/users/${userId}`,
    {
      method: "PATCH",
      body: JSON.stringify(changes),
    },
  );
}

export function getAdminSettings(accessToken) {
  return apiRequest(
    accessToken,
    "/api/v1/admin/settings",
  );
}

export function updateAdminSettings(
  accessToken,
  settings,
) {
  return apiRequest(
    accessToken,
    "/api/v1/admin/settings",
    {
      method: "PATCH",
      body: JSON.stringify(settings),
    },
  );
}
