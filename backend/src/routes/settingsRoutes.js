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

    if (body.mapRouteColors !== undefined) {
      const colors = body.mapRouteColors;
      if (!colors || typeof colors !== "object" || Array.isArray(colors) ||
          Object.keys(colors).some((key) => !["private", "business", "commute", "unclassified"].includes(key)) ||
          Object.values(colors).some((value) => value !== null && (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)))) {
        throw badRequest("VALIDATION_ERROR", "Ungültige Kartenfarben. Erlaubt sind Hex-Farben je Fahrtkategorie.");
      }
    }

    response.json(
      await updateUserSettings(request.auth.userId, body),
    );
  }),
);
