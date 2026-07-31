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
      body?.message ||
        body?.error?.message ||
        "Die Anfrage ist fehlgeschlagen.",
      response.status,
      body?.error?.code ||
        (typeof body?.error === "string"
          ? body.error
          : "REQUEST_FAILED"),
    );
  }

  return body;
}

export function getDashboard(
  accessToken,
  filters = {},
) {
  const query = new URLSearchParams();

  if (filters.from) {
    query.set("from", filters.from);
  }

  if (filters.to) {
    query.set("to", filters.to);
  }

  if (filters.type) {
    query.set("type", filters.type);
  }

  if (filters.tagId) {
    query.set("tagId", filters.tagId);
  }

  const suffix = query.size
    ? `?${query.toString()}`
    : "";

  return apiRequest(
    accessToken,
    `/api/v1/dashboard${suffix}`,
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

export function searchHomeLocations(
  accessToken,
  query,
) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/home-location/search",
    {
      method: "POST",
      body: JSON.stringify({ query }),
    },
  );
}

export function reverseHomeLocation(
  accessToken,
  coordinates,
) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/home-location/reverse",
    {
      method: "POST",
      body: JSON.stringify(coordinates),
    },
  );
}

export function saveHomeLocation(
  accessToken,
  homeLocation,
) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/home-location",
    {
      method: "PUT",
      body: JSON.stringify(homeLocation),
    },
  );
}

export function deleteHomeLocation(accessToken) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/home-location",
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

export function getAdminUser(
  accessToken,
  userId,
) {
  return apiRequest(
    accessToken,
    `/api/v1/admin/users/${encodeURIComponent(
      userId,
    )}`,
  );
}

export function createAdminUser(
  accessToken,
  user,
) {
  return apiRequest(
    accessToken,
    "/api/v1/admin/users",
    {
      method: "POST",
      body: JSON.stringify(user),
    },
  );
}

export function updateAdminUser(
  accessToken,
  userId,
  changes,
) {
  return apiRequest(
    accessToken,
    `/api/v1/admin/users/${encodeURIComponent(
      userId,
    )}`,
    {
      method: "PUT",
      body: JSON.stringify(changes),
    },
  );
}

export function deleteAdminUser(
  accessToken,
  userId,
) {
  return apiRequest(
    accessToken,
    `/api/v1/admin/users/${encodeURIComponent(
      userId,
    )}`,
    {
      method: "DELETE",
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

export function createPairingOptions(
  accessToken,
) {
  return apiRequest(
    accessToken,
    "/api/v1/auth/pair/options",
    {
      method: "POST",
    },
  );
}

export function getPairingStatus(
  accessToken,
  pairId,
) {
  return apiRequest(
    accessToken,
    `/api/v1/auth/pair/${encodeURIComponent(
      pairId,
    )}/status`,
  );
}

export function cancelPairing(
  accessToken,
  pairId,
) {
  return apiRequest(
    accessToken,
    `/api/v1/auth/pair/${encodeURIComponent(
      pairId,
    )}`,
    {
      method: "DELETE",
    },
  );
}

function buildQuery(filters = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }

  return query.size ? `?${query.toString()}` : "";
}

async function downloadRequest(accessToken, path) {
  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.message || "Der Export ist fehlgeschlagen.",
      response.status,
      typeof body?.error === "string"
        ? body.error
        : "EXPORT_FAILED",
    );
  }

  const disposition = response.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);

  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] || "fahrtenbuch-export",
  };
}

export function getVehicles(accessToken) {
  return apiRequest(accessToken, "/api/v1/vehicles");
}

export function createVehicle(accessToken, vehicle) {
  return apiRequest(accessToken, "/api/v1/vehicles", {
    method: "POST",
    body: JSON.stringify(vehicle),
  });
}

export function updateVehicle(accessToken, vehicleId, vehicle) {
  return apiRequest(
    accessToken,
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}`,
    {
      method: "PUT",
      body: JSON.stringify(vehicle),
    },
  );
}

export function deleteVehicle(accessToken, vehicleId) {
  return apiRequest(
    accessToken,
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}`,
    { method: "DELETE" },
  );
}

export function setDefaultVehicle(accessToken, vehicleId) {
  return apiRequest(
    accessToken,
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/default`,
    { method: "PUT" },
  );
}

export function getExportSummary(accessToken, filters) {
  return apiRequest(
    accessToken,
    `/api/v1/export/summary${buildQuery(filters)}`,
  );
}

export function downloadExport(accessToken, format, filters) {
  return downloadRequest(
    accessToken,
    `/api/v1/export/${encodeURIComponent(format)}${buildQuery(filters)}`,
  );
}
