import { translate } from "../i18n/translate.js";
import { ApiError } from "./auth.js";

let refreshAccessTokenHandler = null;

export function configureApiAuth({ refreshAccessToken } = {}) {
  refreshAccessTokenHandler =
    typeof refreshAccessToken === "function"
      ? refreshAccessToken
      : null;

  return () => {
    refreshAccessTokenHandler = null;
  };
}

export async function authenticatedFetch(accessToken, path, options = {}, allowRefresh = true) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
      // Always let the token supplied to this attempt win. This is
      // important when a failed request is retried with a refreshed token.
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (
    allowRefresh &&
    response.status === 401 &&
    refreshAccessTokenHandler
  ) {
    const body = await response.clone().json().catch(() => null);
    const code =
      body?.error?.code ||
      (typeof body?.error === "string" ? body.error : null);

    if (code === "INVALID_ACCESS_TOKEN") {
      try {
        const refreshedAccessToken = await refreshAccessTokenHandler();

        if (refreshedAccessToken) {
          return authenticatedFetch(
            refreshedAccessToken,
            path,
            options,
            false,
          );
        }
      } catch {
        // The auth provider clears the local session when refreshing fails.
      }
    }
  }

  return response;
}

async function apiRequest(
  accessToken,
  path,
  options = {},
) {
  const response = await authenticatedFetch(
    accessToken,
    path,
    options,
  );

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const code =
      body?.error?.code ||
      (typeof body?.error === "string"
        ? body.error
        : "REQUEST_FAILED");

    throw new ApiError(
      code === "INVALID_ACCESS_TOKEN"
        ? translate("common.sessionExpired")
        : body?.message ||
          body?.error?.message ||
          translate("common.requestFailed"),
      response.status,
      code,
    );
  }

  return body;
}

export function apiGet(accessToken, path) {
  return apiRequest(accessToken, path);
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

  if (filters.specialCategory) {
    query.set("specialCategory", filters.specialCategory);
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

export async function getPublicLanguageSettings() {
  const response = await fetch("/api/v1/language", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Language configuration could not be loaded.");
  return response.json();
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

export function saveWorkLocation(
  accessToken,
  workLocation,
) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/work-location",
    {
      method: "PUT",
      body: JSON.stringify(workLocation),
    },
  );
}

export function deleteWorkLocation(accessToken) {
  return apiRequest(
    accessToken,
    "/api/v1/users/me/work-location",
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
  const response = await authenticatedFetch(
    accessToken,
    path,
    {},
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.message || translate("exportPage.failed"),
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

export function deregisterVehicle(accessToken, vehicleId) {
  return apiRequest(accessToken, `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/deregister`, {
    method: "POST",
    body: JSON.stringify({ confirmed: true }),
  });
}

export function registerVehicle(accessToken, vehicleId, effectiveAt) {
  return apiRequest(accessToken, `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/register`, {
    method: "POST",
    body: JSON.stringify({ effectiveAt }),
  });
}

export function transferVehicle(accessToken, vehicleId, account, effectiveAt) {
  return apiRequest(accessToken, `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/transfer`, {
    method: "POST",
    body: JSON.stringify({ account, effectiveAt }),
  });
}

export function getArchivedVehicles(accessToken) {
  return apiRequest(accessToken, "/api/v1/vehicles/archive");
}

export function restoreVehicle(accessToken, vehicleId) {
  return apiRequest(accessToken, `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/restore`, {
    method: "POST",
  });
}

export function getVehicles(accessToken) {
  return apiRequest(accessToken, "/api/v1/vehicles");
}

export function getSharedVehicleActivity(accessToken, vehicleId) {
  return apiRequest(
    accessToken,
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/shared-trip-activity`,
  );
}

export function getVehicleShares(accessToken, vehicleId) {
  return apiRequest(
    accessToken,
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/shares`,
  );
}

export function shareVehicle(accessToken, vehicleId, email) {
  return apiRequest(
    accessToken,
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/shares`,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
  );
}

export function createVehicleShareLink(accessToken, vehicleId) {
  return apiRequest(accessToken, `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/share-link`, { method: "POST" });
}
export function inspectVehicleShareInvitation(accessToken, token) {
  return apiRequest(accessToken, `/api/v1/vehicles/share-invitations/inspect?token=${encodeURIComponent(token)}`);
}
export function respondVehicleShareInvitation(accessToken, token, action) {
  return apiRequest(accessToken, "/api/v1/vehicles/share-invitations/respond", {
    method: "POST", body: JSON.stringify({ token, action }),
  });
}

export function revokeVehicleShare(accessToken, vehicleId, userId) {
  return apiRequest(
    accessToken,
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/shares/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
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

export function disableAdminUserTotp(
  accessToken,
  userId,
) {
  return apiRequest(
    accessToken,
    `/api/v1/admin/users/${encodeURIComponent(
      userId,
    )}/totp`,
    {
      method: "DELETE",
    },
  );
}

export function deleteAdminUserPasskeys(
  accessToken,
  userId,
) {
  return apiRequest(
    accessToken,
    `/api/v1/admin/users/${encodeURIComponent(
      userId,
    )}/passkeys`,
    {
      method: "DELETE",
    },
  );
}

export function deleteAdminUserPasskey(
  accessToken,
  userId,
  passkeyId,
) {
  return apiRequest(
    accessToken,
    `/api/v1/admin/users/${encodeURIComponent(
      userId,
    )}/passkeys/${encodeURIComponent(
      passkeyId,
    )}`,
    {
      method: "DELETE",
    },
  );
}

export function logoutAdminUserSessions(
  accessToken,
  userId,
) {
  return apiRequest(
    accessToken,
    `/api/v1/admin/users/${encodeURIComponent(
      userId,
    )}/sessions`,
    {
      method: "DELETE",
    },
  );
}

export function getTripPoints(accessToken, tripId) {
  return apiRequest(accessToken, `/api/v1/trips/${encodeURIComponent(tripId)}/points`);
}

export function splitTrip(accessToken, tripId, pointId) {
  return apiRequest(accessToken, `/api/v1/trips/${encodeURIComponent(tripId)}/split`, {
    method: "POST",
    body: JSON.stringify({ pointId }),
  });
}

export function mergeTrips(accessToken, tripIds) {
  return apiRequest(accessToken, "/api/v1/trips/merge", {
    method: "POST",
    body: JSON.stringify({ tripIds }),
  });
}

export function getTripHistory(accessToken, tripId) {
  return apiRequest(
    accessToken,
    `/api/v1/trips/${encodeURIComponent(tripId)}/history`,
  );
}


export function getComplianceChecks(accessToken) {
  return apiRequest(accessToken, "/api/v1/compliance/checks");
}

export function getComplianceIntegrity(accessToken) {
  return apiRequest(accessToken, "/api/v1/compliance/integrity");
}

export function getClosedPeriods(accessToken) {
  return apiRequest(accessToken, "/api/v1/compliance/periods");
}

export function closePeriod(accessToken, period) {
  return apiRequest(accessToken, "/api/v1/compliance/periods", {
    method: "POST",
    body: JSON.stringify(period),
  });
}


export function getOdometerReadings(accessToken) {
  return apiRequest(accessToken, "/api/v1/odometer");
}

export function getPendingOdometerReadings(accessToken) {
  return apiRequest(accessToken, "/api/v1/odometer/pending");
}

export function saveMonthlyOdometerReading(accessToken, vehicleId, month, odometerKm, readingDate = null, readingAt = null) {
  return apiRequest(accessToken, `/api/v1/odometer/${vehicleId}/${month}`, {
    method: "PUT",
    body: JSON.stringify({ odometerKm, ...(readingDate ? { readingDate } : {}), ...(readingAt ? { readingAt } : {}) }),
  });
}

export function getOdometerIntervalStatistics(accessToken, vehicleId, from, to) {
  const query = new URLSearchParams({ vehicleId, from, to });
  return apiRequest(accessToken, `/api/v1/statistics/odometer-intervals?${query.toString()}`);
}

export function getMonthlyOdometerStatistics(accessToken, months = 12) {
  return apiRequest(accessToken, `/api/v1/statistics/monthly-odometer?months=${months}`);
}


export function getAssignableTripDrivers(accessToken, tripId) {
  return apiRequest(accessToken, `/api/v1/trips/${encodeURIComponent(tripId)}/assignable-drivers`);
}
export function assignTripDriver(accessToken, tripId, userId, reason = "") {
  return apiRequest(accessToken, `/api/v1/trips/${encodeURIComponent(tripId)}/assign-driver`, {
    method: "POST", body: JSON.stringify({ userId, ...(reason ? { reason } : {}) }),
  });
}

export function getTripSuggestions(accessToken, tripId) {
  return apiRequest(accessToken, `/api/v1/trips/${encodeURIComponent(tripId)}/suggestions`);
}
export function correctTripRoute(accessToken, tripId, points) {
  return apiRequest(accessToken, `/api/v1/trips/${encodeURIComponent(tripId)}/route-correction`, {
    method: "POST", body: JSON.stringify({ points }),
  });
}
export function getSavedPlaces(accessToken) {
  return apiRequest(accessToken, "/api/v1/places");
}
export function createSavedPlace(accessToken, place) {
  return apiRequest(accessToken, "/api/v1/places", { method: "POST", body: JSON.stringify(place) });
}
export function updateSavedPlace(accessToken, id, place) {
  return apiRequest(accessToken, `/api/v1/places/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(place) });
}
export function deleteSavedPlace(accessToken, id) {
  return apiRequest(accessToken, `/api/v1/places/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export const archiveTrip = (token, id) => apiRequest(token, `/api/v1/trips/${encodeURIComponent(id)}`, { method: "DELETE" });
export const getArchivedTrips = (token) => apiRequest(token, "/api/v1/trips/archive");
export const restoreArchivedTrip = (token, id) => apiRequest(token, `/api/v1/trips/${encodeURIComponent(id)}/restore`, { method: "POST" });
export const permanentlyDeleteTrip = (token, id) => apiRequest(token, `/api/v1/trips/${encodeURIComponent(id)}/permanent`, { method: "DELETE" });

// extra: weitere Felder wie reimbursementRateEur (nur mitschicken, wenn geändert)
export const classifyTrip = (token, id, category, specialCategory = null, extra = null) => apiRequest(token, `/api/v1/trips/${encodeURIComponent(id)}/classify`, {
  method: "PUT",
  body: JSON.stringify({ category, specialCategory, ...(extra || {}) }),
});
export const updateTripTags = (token, id, tagIds) => apiRequest(token, `/api/v1/trips/${encodeURIComponent(id)}/tags`, { method: "PUT", body: JSON.stringify({ tagIds }) });

export const getJobStatus = (token) => apiRequest(token, "/api/v1/admin/jobs/status");
export const getAdminJobs = (token, state) => apiRequest(token, "/api/v1/admin/jobs?state=" + encodeURIComponent(state));
export const retryAdminJob = (token, id) => apiRequest(token, "/api/v1/admin/jobs/" + encodeURIComponent(id) + "/retry", { method: "POST" });
export const deleteAdminJob = (token, id) => apiRequest(token, "/api/v1/admin/jobs/" + encodeURIComponent(id), { method: "DELETE" });

export const startReverseGeocodeJobs = (token, mode = "missing", limit = 500) =>
  apiRequest(token, "/api/v1/admin/jobs/reverse-geocode", {
    method: "POST",
    body: JSON.stringify({ mode, limit }),
  });

export const getMapMatchingStatus = (token) =>
  apiRequest(token, "/api/v1/admin/jobs/map-matching");

export const startMapMatchingJobs = (token, mode = "missing", limit = 500) =>
  apiRequest(token, "/api/v1/admin/jobs/map-matching", {
    method: "POST",
    body: JSON.stringify({ mode, limit }),
  });

export const getMapMatchingIssues = (token, status) =>
  apiRequest(token, "/api/v1/admin/jobs/map-matching/issues" + (status ? "?status=" + encodeURIComponent(status) : ""));

export const getTripMatchedRoute = (token, tripId) =>
  apiRequest(token, `/api/v1/trips/${encodeURIComponent(tripId)}/matched-route`);

export const getMonthlyCategoryTrips = (token, vehicleId, month, type) =>
  apiRequest(token, "/api/v1/statistics/monthly-trips?" + new URLSearchParams({ vehicleId, month, type }).toString());

export function getLeasingLiveKm(accessToken, vehicleId) {
  return apiRequest(accessToken, `/api/v1/statistics/leasing-live-km?vehicleId=${encodeURIComponent(vehicleId)}`);
}

// Fahrzeugkosten (Tanken/Laden und sonstige Kosten)
export function getExpenses(accessToken, filters = {}) {
  const query = new URLSearchParams();
  for (const key of ["vehicleId", "from", "to", "category"]) {
    if (filters[key]) query.set(key, filters[key]);
  }
  return apiRequest(accessToken, `/api/v1/expenses${query.size ? `?${query}` : ""}`);
}

export function getExpenseSummary(accessToken, { vehicleId, from, to }) {
  const query = new URLSearchParams({ vehicleId });
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  return apiRequest(accessToken, `/api/v1/expenses/summary?${query}`);
}

export function createExpense(accessToken, expense) {
  return apiRequest(accessToken, "/api/v1/expenses", { method: "POST", body: JSON.stringify(expense) });
}

export function updateExpense(accessToken, id, expense) {
  return apiRequest(accessToken, `/api/v1/expenses/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(expense) });
}

export function deleteExpense(accessToken, id) {
  return apiRequest(accessToken, `/api/v1/expenses/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// CSV-Import (z. B. Spritmonitor). Datei als Base64 im JSON-Body – vermeidet Multipart-Sonderfälle.
export function previewExpenseImport(accessToken, payload) {
  return apiRequest(accessToken, "/api/v1/expenses/import/preview", { method: "POST", body: JSON.stringify(payload) });
}

export function importExpenses(accessToken, payload) {
  return apiRequest(accessToken, "/api/v1/expenses/import", { method: "POST", body: JSON.stringify(payload) });
}

// Geocoding (Photon) und Routing (Valhalla/OSRM) – Reiter „Geocoding“ in den Systemeinstellungen
export const getAdminServiceSettings = (token) =>
  apiRequest(token, "/api/v1/admin/settings/services");

export const updateAdminPhotonSettings = (token, photon) =>
  apiRequest(token, "/api/v1/admin/settings/services/photon", {
    method: "PUT",
    body: JSON.stringify(photon),
  });

export const testAdminService = (token, category, config) =>
  apiRequest(token, "/api/v1/admin/settings/services/test", {
    method: "POST",
    body: JSON.stringify({ category, config }),
  });

export const updateAdminAtlasSettings = (token, atlas) =>
  apiRequest(token, "/api/v1/admin/settings/services/atlas", {
    method: "PUT",
    body: JSON.stringify(atlas),
  });

export const runAdminServiceCheck = (token, module) =>
  apiRequest(
    token,
    "/api/v1/admin/settings/services/check" +
      (module ? "?module=" + encodeURIComponent(module) : ""),
  );

// Ersteinrichtung des Servers (Admin) und Einrichtungsassistent für Benutzer
export const getAdminSetup = (token) => apiRequest(token, "/api/v1/admin/setup");
export const completeAdminSetup = (token) =>
  apiRequest(token, "/api/v1/admin/setup/complete", { method: "POST" });
export const completeOnboarding = (token) =>
  apiRequest(token, "/api/v1/users/me/onboarding", { method: "POST" });

// SMTP: konfiguriert über SMTP_* in der .env; die Oberfläche zeigt nur Status und Test
export const getAdminMailStatus = (token) => apiRequest(token, "/api/v1/admin/mail");
export const sendAdminTestMail = (token, payload = {}) =>
  apiRequest(token, "/api/v1/admin/mail/test", { method: "POST", body: JSON.stringify(payload) });

// Monatsbericht (gleicher Inhalt wie die Mail am Monatsersten)
export const getMonthlyReport = (token, month) =>
  apiRequest(token, "/api/v1/reports/monthly" + (month ? "?month=" + encodeURIComponent(month) : ""));
export const sendMonthlyReport = (token, month) =>
  apiRequest(token, "/api/v1/reports/monthly/send", { method: "POST", body: JSON.stringify(month ? { month } : {}) });

// Einzelne GPS-Punkte entfernen (z. B. Sprünge); Distanz wird serverseitig neu berechnet
export function removeTripPoints(accessToken, tripId, pointIds) {
  return apiRequest(accessToken, `/api/v1/trips/${encodeURIComponent(tripId)}/points/remove`, {
    method: "POST",
    body: JSON.stringify({ pointIds }),
  });
}

// Persönliche Dawarich-Verbindung; der API-Key kommt nie zurück (nur apiKeyHint)
export const getDawarichConnection = (token) => apiRequest(token, "/api/v1/users/me/dawarich");
export const saveDawarichConnection = (token, payload) =>
  apiRequest(token, "/api/v1/users/me/dawarich", { method: "PUT", body: JSON.stringify(payload) });
export const deleteDawarichConnection = (token) =>
  apiRequest(token, "/api/v1/users/me/dawarich", { method: "DELETE" });
export const testDawarichConnection = (token) =>
  apiRequest(token, "/api/v1/users/me/dawarich/test", { method: "POST" });

// Lücken einer Fahrt mit Punkten aus Dawarich füllen
export const importTripPointsFromDawarich = (token, tripId) =>
  apiRequest(token, `/api/v1/trips/${encodeURIComponent(tripId)}/dawarich-import`, { method: "POST" });

// Manuell angelegte Fahrt (POST /trips, source=manual)
export const createTrip = (token, payload) =>
  apiRequest(token, "/api/v1/trips", { method: "POST", body: JSON.stringify(payload) });

// Adresssuche über den eingerichteten Photon-Dienst
export const searchAddresses = (token, query, lang) =>
  apiRequest(token, `/api/v1/geocoding/search?q=${encodeURIComponent(query)}&limit=6&lang=${encodeURIComponent(lang || "de")}`);

// Straßenstrecke zwischen zwei Koordinaten (Routing-Dienst des Servers)
export const estimateRoute = (token, from, to) =>
  apiRequest(token, `/api/v1/geocoding/route?fromLat=${from.lat}&fromLon=${from.lon}&toLat=${to.lat}&toLon=${to.lon}`);

// Einzelne Fahrt und Kartenvorgaben für die Fahrtseite (/trip/:id)
export const getTrip = (token, tripId) => apiRequest(token, `/api/v1/trips/${encodeURIComponent(tripId)}`);
export const getMapSettings = (token) => apiRequest(token, "/api/v1/map/settings");

// Fahrt-Editor: Pfad mit über die Straße gefüllten Lücken und Speichern der Route
export const routeTripPath = (token, points) =>
  apiRequest(token, "/api/v1/geocoding/route-path", { method: "POST", body: JSON.stringify({ points }) });
export const saveTripRoute = (token, tripId, payload) =>
  apiRequest(token, `/api/v1/trips/${encodeURIComponent(tripId)}/route`, { method: "PUT", body: JSON.stringify(payload) });

// Rückwärts-Geocoding über den eingerichteten Photon-Dienst (z. B. „Nähe“ im Fahrt-Editor)
export const reverseGeocode = (token, lat, lon, lang) =>
  apiRequest(token, `/api/v1/geocoding/reverse?lat=${lat}&lon=${lon}&lang=${encodeURIComponent(lang || "de")}`);

// Erzeugte Punkte verwerfen und die Route zwischen eigenen Punkten neu berechnen (speichert direkt)
export const recalculateTripRoute = (token, tripId) =>
  apiRequest(token, `/api/v1/trips/${encodeURIComponent(tripId)}/route/recalculate`, { method: "POST" });
