import {
  ApiError,
} from "./auth.js";

function filenameFromResponse(
  response,
  fallback,
) {
  const disposition =
    response.headers.get(
      "content-disposition",
    ) || "";

  const match =
    disposition.match(
      /filename="?([^";]+)"?/i,
    );

  return match?.[1] || fallback;
}

async function errorFromResponse(
  response,
  fallback,
) {
  const body = await response
    .json()
    .catch(() => null);

  return new ApiError(
    body?.message ||
      body?.error?.message ||
      fallback,
    response.status,
    typeof body?.error === "string"
      ? body.error
      : body?.error?.code ||
          "DATA_TRANSFER_FAILED",
  );
}

async function download(
  accessToken,
  path,
  fallbackFilename,
) {
  const response = await fetch(path, {
    headers: {
      Authorization:
        `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw await errorFromResponse(
      response,
      "Der Datenexport ist fehlgeschlagen.",
    );
  }

  return {
    blob: await response.blob(),
    filename:
      filenameFromResponse(
        response,
        fallbackFilename,
      ),
    checksum:
      response.headers.get(
        "x-fahrtenbuch-sha256",
      ),
  };
}

async function upload(
  accessToken,
  path,
  file,
  options = {},
) {
  const body = new FormData();

  body.append("file", file);
  body.append(
    "dryRun",
    options.dryRun
      ? "true"
      : "false",
  );

  if (
    options.restoreSystemSettings !==
    undefined
  ) {
    body.append(
      "restoreSystemSettings",
      options.restoreSystemSettings
        ? "true"
        : "false",
    );
  }

  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization:
        `Bearer ${accessToken}`,
    },
    body,
  });

  const result = await response
    .json()
    .catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      result?.message ||
        result?.error?.message ||
        "Der Datenimport ist fehlgeschlagen.",
      response.status,
      typeof result?.error ===
        "string"
        ? result.error
        : result?.error?.code ||
            "DATA_IMPORT_FAILED",
    );
  }

  return result;
}

export function downloadOwnData(
  accessToken,
) {
  return download(
    accessToken,
    "/api/v1/export/data",
    "fahrtenbuch-meine-daten.json",
  );
}

export function validateOwnDataImport(
  accessToken,
  file,
) {
  return upload(
    accessToken,
    "/api/v1/import/data",
    file,
    {
      dryRun: true,
    },
  );
}

export function importOwnData(
  accessToken,
  file,
) {
  return upload(
    accessToken,
    "/api/v1/import/data",
    file,
    {
      dryRun: false,
    },
  );
}

export function downloadSystemData(
  accessToken,
) {
  return download(
    accessToken,
    "/api/v1/admin/data/export",
    "fahrtenbuch-system.json",
  );
}

export function validateSystemDataImport(
  accessToken,
  file,
  {
    restoreSystemSettings = false,
  } = {},
) {
  return upload(
    accessToken,
    "/api/v1/admin/data/import",
    file,
    {
      dryRun: true,
      restoreSystemSettings,
    },
  );
}

export function importSystemData(
  accessToken,
  file,
  {
    restoreSystemSettings = false,
  } = {},
) {
  return upload(
    accessToken,
    "/api/v1/admin/data/import",
    file,
    {
      dryRun: false,
      restoreSystemSettings,
    },
  );
}
