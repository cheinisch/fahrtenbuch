import { Router } from "express";

import { pool } from "../database/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const homeLocationRoutes = Router();

homeLocationRoutes.use(requireAuth);

const DEFAULT_PHOTON_URL = "https://photon.komoot.io";
const PHOTON_TIMEOUT_MS = 10_000;

function sendError(response, status, code, message) {
  return response.status(status).json({
    error: {
      code,
      message,
    },
  });
}

function isValidCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function getPhotonBaseUrl() {
  return String(
    process.env.PHOTON_URL || DEFAULT_PHOTON_URL,
  ).replace(/\/+$/, "");
}

function createPhotonUrl(endpoint, parameters) {
  const url = new URL(
    `${getPhotonBaseUrl()}${endpoint}`,
  );

  for (const [key, value] of Object.entries(parameters)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

async function requestPhoton(url) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PHOTON_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Fahrtenbuch/0.1 (+self-hosted)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Photon antwortete mit HTTP ${response.status}.`,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildAddress(properties = {}) {
  const street = [
    properties.street,
    properties.housenumber,
  ]
    .filter(Boolean)
    .join(" ");

  const city = [
    properties.postcode,
    properties.city ||
      properties.town ||
      properties.village ||
      properties.county,
  ]
    .filter(Boolean)
    .join(" ");

  const parts = [
    properties.name,
    street,
    city,
    properties.state,
    properties.country,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  return [...new Set(parts)].join(", ");
}

function mapFeature(feature) {
  const coordinates = feature?.geometry?.coordinates;
  const longitude = Number(coordinates?.[0]);
  const latitude = Number(coordinates?.[1]);

  if (!isValidCoordinate(latitude, longitude)) {
    return null;
  }

  const address =
    buildAddress(feature.properties) ||
    `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

  return {
    address,
    latitude,
    longitude,
    source: "manual",
  };
}

async function loadHomeLocation(userId) {
  const result = await pool.query(
    `
      SELECT settings -> 'homeLocation' AS home_location
      FROM user_settings
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0]?.home_location || null;
}

homeLocationRoutes.get(
  "/",
  async (request, response, next) => {
    try {
      response.json({
        homeLocation:
          await loadHomeLocation(request.auth.userId),
      });
    } catch (error) {
      next(error);
    }
  },
);

homeLocationRoutes.post(
  "/search",
  async (request, response, next) => {
    try {
      const query = String(
        request.body?.query || "",
      ).trim();

      if (query.length < 3 || query.length > 250) {
        return sendError(
          response,
          400,
          "INVALID_HOME_QUERY",
          "Bitte gib mindestens drei Zeichen für die Adresse ein.",
        );
      }

      const url = createPhotonUrl("/api/", {
        q: query,
        limit: 6,
        lang: request.body?.language || "de",
      });

      const result = await requestPhoton(url);

      const candidates = (result.features || [])
        .map(mapFeature)
        .filter(Boolean);

      response.json({ candidates });
    } catch (error) {
      if (error?.name === "AbortError") {
        return sendError(
          response,
          504,
          "GEOCODING_TIMEOUT",
          "Die Adresssuche hat zu lange gedauert.",
        );
      }

      next(error);
    }
  },
);

homeLocationRoutes.post(
  "/reverse",
  async (request, response, next) => {
    try {
      const latitude = Number(
        request.body?.latitude,
      );
      const longitude = Number(
        request.body?.longitude,
      );

      if (!isValidCoordinate(latitude, longitude)) {
        return sendError(
          response,
          400,
          "INVALID_HOME_COORDINATES",
          "Die übermittelten Koordinaten sind ungültig.",
        );
      }

      const url = createPhotonUrl("/reverse", {
        lat: latitude,
        lon: longitude,
        lang: request.body?.language || "de",
      });

      const result = await requestPhoton(url);
      const candidate = (result.features || [])
        .map(mapFeature)
        .find(Boolean);

      response.json({
        candidate: {
          address:
            candidate?.address ||
            `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
          latitude,
          longitude,
          source: "gps",
        },
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return sendError(
          response,
          504,
          "REVERSE_GEOCODING_TIMEOUT",
          "Die Standortbestimmung hat zu lange gedauert.",
        );
      }

      next(error);
    }
  },
);

homeLocationRoutes.put(
  "/",
  async (request, response, next) => {
    try {
      const address = String(
        request.body?.address || "",
      ).trim();

      const latitude = Number(
        request.body?.latitude,
      );
      const longitude = Number(
        request.body?.longitude,
      );

      const source = String(
        request.body?.source || "manual",
      );

      if (address.length < 1 || address.length > 500) {
        return sendError(
          response,
          400,
          "INVALID_HOME_ADDRESS",
          "Der Heimatort benötigt eine gültige Bezeichnung.",
        );
      }

      if (!isValidCoordinate(latitude, longitude)) {
        return sendError(
          response,
          400,
          "INVALID_HOME_COORDINATES",
          "Die Koordinaten des Heimatorts sind ungültig.",
        );
      }

      if (!["manual", "gps"].includes(source)) {
        return sendError(
          response,
          400,
          "INVALID_HOME_SOURCE",
          "Die Quelle des Heimatorts ist ungültig.",
        );
      }

      const homeLocation = {
        address,
        latitude,
        longitude,
        source,
        updatedAt: new Date().toISOString(),
      };

      const result = await pool.query(
        `
          INSERT INTO user_settings (
            user_id,
            settings
          )
          VALUES (
            $1,
            jsonb_build_object(
              'homeLocation',
              $2::jsonb
            )
          )
          ON CONFLICT (user_id)
          DO UPDATE SET
            settings = jsonb_set(
              COALESCE(
                user_settings.settings,
                '{}'::jsonb
              ),
              '{homeLocation}',
              $2::jsonb,
              true
            )
          RETURNING settings -> 'homeLocation'
            AS home_location
        `,
        [
          request.auth.userId,
          JSON.stringify(homeLocation),
        ],
      );

      await pool.query(
        `
          INSERT INTO audit_log (
            actor_user_id,
            action,
            entity_type,
            entity_id,
            metadata
          )
          VALUES (
            $1,
            'user.home_location_updated',
            'user',
            $1,
            $2::jsonb
          )
        `,
        [
          request.auth.userId,
          JSON.stringify({
            source,
            latitude,
            longitude,
          }),
        ],
      );

      response.json({
        homeLocation:
          result.rows[0].home_location,
      });
    } catch (error) {
      next(error);
    }
  },
);

homeLocationRoutes.delete(
  "/",
  async (request, response, next) => {
    try {
      await pool.query(
        `
          UPDATE user_settings
          SET settings =
            COALESCE(settings, '{}'::jsonb)
            - 'homeLocation'
          WHERE user_id = $1
        `,
        [request.auth.userId],
      );

      response.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
