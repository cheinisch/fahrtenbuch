import {
  ApiError,
} from "./auth.js";

async function request(
  accessToken,
  path,
) {
  const response = await fetch(path, {
    headers: {
      Accept: "application/json",
      Authorization:
        `Bearer ${accessToken}`,
    },
  });

  const body = await response
    .json()
    .catch(() => null);

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

function buildQuery(filters = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(
    filters,
  )) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      query.set(key, String(value));
    }
  }

  return query.size
    ? `?${query.toString()}`
    : "";
}

export function getExportCountryOptions(
  accessToken,
) {
  return request(
    accessToken,
    "/api/v1/export/countries",
  );
}

export function getCountryExportSummary(
  accessToken,
  filters,
) {
  return request(
    accessToken,
    `/api/v1/export/summary${buildQuery(
      filters,
    )}`,
  );
}

export async function downloadCountryExport(
  accessToken,
  format,
  filters,
) {
  const response = await fetch(
    `/api/v1/export/${encodeURIComponent(
      format,
    )}${buildQuery(filters)}`,
    {
      headers: {
        Authorization:
          `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => null);

    throw new ApiError(
      body?.message ||
        "Der Export ist fehlgeschlagen.",
      response.status,
      typeof body?.error === "string"
        ? body.error
        : body?.error?.code ||
            "EXPORT_FAILED",
    );
  }

  const disposition =
    response.headers.get(
      "content-disposition",
    ) || "";

  const filenameMatch = disposition.match(
    /filename="?([^";]+)"?/i,
  );

  return {
    blob: await response.blob(),
    filename:
      filenameMatch?.[1] ||
      "fahrtenbuch-export",
  };
}
