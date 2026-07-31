import { Router } from "express";

import { badRequest } from "../lib/errors.js";
import {
  integerField,
  objectBody,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  getUserSettings,
  updateUserSettings,
} from "../services/userSettingsService.js";

export const settingsRoutes = Router();

settingsRoutes.use(requireAuth);

settingsRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    response.json(await getUserSettings(request.auth.userId));
  }),
);

settingsRoutes.put(
  "/",
  asyncHandler(async (request, response) => {
    const body = objectBody(request.body);

    if (
      body.trackingAccuracyMode !== undefined &&
      !["high", "balanced", "battery"].includes(body.trackingAccuracyMode)
    ) {
      throw badRequest(
        "VALIDATION_ERROR",
        "Der Genauigkeitsmodus ist ungültig.",
      );
    }

    if (body.stopDelaySeconds !== undefined) {
      integerField(body, "stopDelaySeconds", {
        minimum: 0,
        maximum: 3600,
      });
    }

    response.json(
      await updateUserSettings(request.auth.userId, body),
    );
  }),
);
