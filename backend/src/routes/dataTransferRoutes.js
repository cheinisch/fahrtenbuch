import {
  createHash,
} from "node:crypto";
import { Router } from "express";
import multer from "multer";

import { config } from "../config.js";
import { pool } from "../database/pool.js";
import {
  badRequest,
} from "../lib/errors.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  createSystemDataBundle,
  createUserDataBundle,
  importSystemDataBundle,
  importUserDataBundle,
  SYSTEM_DATA_KIND,
  USER_DATA_KIND,
  validateDataBundle,
} from "../services/dataTransferService.js";

export const userDataExportRoutes =
  Router();

export const userDataImportRoutes =
  Router();

export const adminDataRoutes =
  Router();

userDataExportRoutes.use(
  requireAuth,
);

userDataImportRoutes.use(
  requireAuth,
);

adminDataRoutes.use(
  requireAuth,
);

adminDataRoutes.use(
  requireAdmin,
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploadLimitBytes,
    files: 1,
  },
});

function parseBoolean(value) {
  return [
    "1",
    "true",
    "yes",
    "on",
  ].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function parseJsonFile(
  request,
  expectedKind,
) {
  if (!request.file) {
    throw badRequest(
      "FILE_REQUIRED",
      "Eine JSON-Datei ist erforderlich.",
    );
  }

  let bundle;

  try {
    bundle = JSON.parse(
      request.file.buffer.toString(
        "utf8",
      ),
    );
  } catch (error) {
    throw badRequest(
      "INVALID_JSON",
      "Die JSON-Datei konnte nicht gelesen werden.",
      {
        parserMessage:
          error.message,
      },
    );
  }

  return validateDataBundle(
    bundle,
    expectedKind,
  );
}

function safeFilenamePart(value) {
  return String(
    value || "fahrtenbuch",
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9äöüß_-]+/gi,
      "-",
    )
    .replace(/^-+|-+$/g, "") ||
    "fahrtenbuch";
}

function sendJsonDownload(
  response,
  bundle,
  filename,
) {
  const body = JSON.stringify(
    bundle,
    null,
    2,
  );

  const checksum =
    createHash("sha256")
      .update(body)
      .digest("hex");

  response.setHeader(
    "Content-Type",
    "application/json; charset=utf-8",
  );

  response.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );

  response.setHeader(
    "Cache-Control",
    "no-store",
  );

  response.setHeader(
    "X-Fahrtenbuch-SHA256",
    checksum,
  );

  response.send(body);
}

async function writeAuditLog(
  client,
  request,
  action,
  metadata,
) {
  await client.query(
    `
      INSERT INTO audit_log (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        request_id,
        ip_address,
        user_agent,
        metadata
      )
      VALUES (
        $1,
        $2,
        'data_transfer',
        NULL,
        $3,
        NULLIF($4, '')::inet,
        $5,
        $6::jsonb
      )
    `,
    [
      request.auth.userId,
      action,
      request.id ||
        request.requestId ||
        null,
      request.ip || "",
      request.get(
        "user-agent",
      ) || null,
      JSON.stringify(
        metadata || {},
      ),
    ],
  );
}

userDataExportRoutes.get(
  "/data",
  asyncHandler(async (
    request,
    response,
  ) => {
    const client =
      await pool.connect();

    try {
      const bundle =
        await createUserDataBundle(
          client,
          request.auth.userId,
        );

      await writeAuditLog(
        client,
        request,
        "user.data.export",
        {
          bundleId:
            bundle.bundleId,
          schemaVersion:
            bundle.schemaVersion,
        },
      );

      sendJsonDownload(
        response,
        bundle,
        `fahrtenbuch-meine-daten-${new Date()
          .toISOString()
          .slice(0, 10)}.json`,
      );
    } finally {
      client.release();
    }
  }),
);

userDataImportRoutes.post(
  "/data",
  upload.single("file"),
  asyncHandler(async (
    request,
    response,
  ) => {
    const bundle =
      parseJsonFile(
        request,
        USER_DATA_KIND,
      );

    const dryRun =
      parseBoolean(
        request.body?.dryRun,
      );

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const result =
        await importUserDataBundle(
          client,
          request.auth.userId,
          bundle,
        );

      if (dryRun) {
        await client.query(
          "ROLLBACK",
        );
      } else {
        await writeAuditLog(
          client,
          request,
          "user.data.import",
          {
            bundleId:
              bundle.bundleId,
            schemaVersion:
              bundle.schemaVersion,
            result,
          },
        );

        await client.query(
          "COMMIT",
        );
      }

      response.json({
        dryRun,
        mode: "merge",
        bundle: {
          kind: bundle.kind,
          schemaVersion:
            bundle.schemaVersion,
          bundleId:
            bundle.bundleId,
          exportedAt:
            bundle.exportedAt,
        },
        result,
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK",
        );
      } catch {
        // Die ursprüngliche Fehlermeldung
        // soll erhalten bleiben.
      }

      throw error;
    } finally {
      client.release();
    }
  }),
);

adminDataRoutes.get(
  "/export",
  asyncHandler(async (
    request,
    response,
  ) => {
    const client =
      await pool.connect();

    try {
      const bundle =
        await createSystemDataBundle(
          client,
        );

      await writeAuditLog(
        client,
        request,
        "admin.data.export",
        {
          bundleId:
            bundle.bundleId,
          schemaVersion:
            bundle.schemaVersion,
          users:
            bundle.users.length,
        },
      );

      sendJsonDownload(
        response,
        bundle,
        `fahrtenbuch-system-${safeFilenamePart(
          config.version,
        )}-${new Date()
          .toISOString()
          .slice(0, 10)}.json`,
      );
    } finally {
      client.release();
    }
  }),
);

adminDataRoutes.post(
  "/import",
  upload.single("file"),
  asyncHandler(async (
    request,
    response,
  ) => {
    const bundle =
      parseJsonFile(
        request,
        SYSTEM_DATA_KIND,
      );

    const dryRun =
      parseBoolean(
        request.body?.dryRun,
      );

    const restoreSystemSettings =
      parseBoolean(
        request.body
          ?.restoreSystemSettings,
      );

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const result =
        await importSystemDataBundle(
          client,
          request.auth.userId,
          bundle,
          {
            restoreSystemSettings,
          },
        );

      if (dryRun) {
        await client.query(
          "ROLLBACK",
        );
      } else {
        await writeAuditLog(
          client,
          request,
          "admin.data.import",
          {
            bundleId:
              bundle.bundleId,
            schemaVersion:
              bundle.schemaVersion,
            restoreSystemSettings,
            result,
          },
        );

        await client.query(
          "COMMIT",
        );
      }

      response.json({
        dryRun,
        mode: "merge",
        restoreSystemSettings,
        bundle: {
          kind: bundle.kind,
          schemaVersion:
            bundle.schemaVersion,
          bundleId:
            bundle.bundleId,
          exportedAt:
            bundle.exportedAt,
        },
        result,
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK",
        );
      } catch {
        // Die ursprüngliche Fehlermeldung
        // soll erhalten bleiben.
      }

      throw error;
    } finally {
      client.release();
    }
  }),
);
