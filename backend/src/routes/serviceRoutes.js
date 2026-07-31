import { Router } from "express";

import {
  badRequest,
} from "../lib/errors.js";
import {
  numberField,
  queryInteger,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  overpassNearby,
  photonReverse,
  photonSearch,
} from "../services/geocodingService.js";
import { getPublicServiceConfiguration } from "../services/serviceSettingsService.js";

export const configRoutes = Router();
export const geocodingRoutes = Router();

configRoutes.use(requireAuth);
geocodingRoutes.use(requireAuth);

configRoutes.get(
  "/services",
  asyncHandler(async (_request, response) => {
    response.json(await getPublicServiceConfiguration());
  }),
);

geocodingRoutes.get(
  "/search",
  asyncHandler(async (request, response) => {
    const query = String(request.query.q || "").trim();

    if (query.length < 2 || query.length > 250) {
      throw badRequest(
        "VALIDATION_ERROR",
        "Der Suchtext muss zwischen 2 und 250 Zeichen lang sein.",
      );
    }

    const language = String(request.query.lang || "de").slice(0, 16);
    const limit = queryInteger(request.query.limit, "limit", {
      fallback: 10,
      minimum: 1,
      maximum: 50,
    });
    const result = await photonSearch(query, language, limit);

    response.json({
      query,
      results: result.results,
      responseTimeMs: result.responseTimeMs,
    });
  }),
);

geocodingRoutes.get(
  "/reverse",
  asyncHandler(async (request, response) => {
    const latitude = numberField(request.query, "lat", {
      required: true,
      minimum: -90,
      maximum: 90,
    });
    const longitude = numberField(request.query, "lon", {
      required: true,
      minimum: -180,
      maximum: 180,
    });
    const language = String(request.query.lang || "de").slice(0, 16);
    const result = await photonReverse(latitude, longitude, language);

    response.json({
      result: result.result,
      responseTimeMs: result.responseTimeMs,
    });
  }),
);

geocodingRoutes.get(
  "/nearby",
  asyncHandler(async (request, response) => {
    const latitude = numberField(request.query, "lat", {
      required: true,
      minimum: -90,
      maximum: 90,
    });
    const longitude = numberField(request.query, "lon", {
      required: true,
      minimum: -180,
      maximum: 180,
    });
    const category = String(request.query.category || "");
    const allowed = [
      "sight",
      "restaurant",
      "hotel",
      "park",
      "fuel",
      "parking",
      "supermarket",
      "charging_station",
      "hospital",
      "pharmacy",
    ];

    if (!allowed.includes(category)) {
      throw badRequest(
        "VALIDATION_ERROR",
        "Die POI-Kategorie ist ungültig.",
        { allowed },
      );
    }

    const result = await overpassNearby(latitude, longitude, category);

    response.json({
      category,
      latitude,
      longitude,
      results: result.results,
      responseTimeMs: result.responseTimeMs,
    });
  }),
);
