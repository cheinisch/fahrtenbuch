import { Router } from "express";

import { config } from "../config.js";

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
import { MAX_ROUTED_GAPS, routeBetween, routePath } from "../services/routingService.js";
import { MAX_EDITOR_POINTS } from "../services/tripEditorService.js";
import {
  getSetupState,
  isGravatarEnabled,
  isMailConfigured,
} from "../services/systemSettingsService.js";

export const configRoutes = Router();
export const geocodingRoutes = Router();

configRoutes.use(requireAuth);
geocodingRoutes.use(requireAuth);

configRoutes.get(
  "/services",
  asyncHandler(async (_request, response) => {
    response.json({
      ...(await getPublicServiceConfiguration()),
      // Clients blenden Funktionen aus, die auf diesem Server (noch) nicht aktiv sind
      features: { ...config.features },
      channel: config.channel,
      // Additiv: Ersteinrichtung abgeschlossen? Ohne SMTP blenden Clients E-Mail-Funktionen aus.
      setup: { completed: (await getSetupState()).completed },
      mail: { enabled: isMailConfigured() },
      gravatar: { enabled: isGravatarEnabled() },
    });
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

// Straßenstrecke zwischen zwei Orten, z. B. für manuell angelegte Fahrten
geocodingRoutes.get(
  "/route",
  asyncHandler(async (request, response) => {
    const coordinate = (prefix) => ({
      lat: numberField(request.query, `${prefix}Lat`, { required: true, minimum: -90, maximum: 90 }),
      lon: numberField(request.query, `${prefix}Lon`, { required: true, minimum: -180, maximum: 180 }),
    });
    response.json(await routeBetween(coordinate("from"), coordinate("to")));
  }),
);

// Pfad durch die Punkte des Fahrt-Editors; Lücken werden über die Straße geroutet
geocodingRoutes.post(
  "/route-path",
  asyncHandler(async (request, response) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const points = Array.isArray(body.points) ? body.points : [];
    if (points.length < 2 || points.length > MAX_EDITOR_POINTS) {
      throw badRequest("VALIDATION_ERROR", `Es werden 2 bis ${MAX_EDITOR_POINTS} Punkte benötigt.`);
    }
    const normalized = points.map((point, index) => {
      const lat = Number(point?.lat);
      const lon = Number(point?.lon);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
        throw badRequest("VALIDATION_ERROR", `Punkt ${index + 1} ist ungültig.`);
      }
      return { lat, lon };
    });
    const gapMeters = body.gapMeters == null ? undefined : numberField(body, "gapMeters", { minimum: 50, maximum: 100_000 });
    response.json({ maxGaps: MAX_ROUTED_GAPS, ...(await routePath(normalized, { gapMeters })) });
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
